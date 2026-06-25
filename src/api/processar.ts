/**
 * Processamento de jobs no runtime stateless (cron + `env.DB`) — o substituto da
 * `FilaEmMemoria` (F5) no Cloudflare Workers (CLAUDE.md §11).
 *
 * Cada tick do cron chama {@link avancarJobs}: para cada job ativo, semeia as linhas
 * a partir da planilha (uma vez) e processa **um lote** de linhas PENDENTE. Idempotência
 * (pula CONCLUIDO via semeadura `DO NOTHING`) e falha isolada (por linha e por job).
 */
import type { Job, LinhaResultado } from '../types/index.js';
import { COLUNAS } from '../types/index.js';
import { processarLinha } from '../pipeline/processar-linha.js';
import { processarComConcorrencia, agora } from '../pipeline/concorrencia.js';
import type { SheetsClient } from '../sheets/index.js';
import type { Env, GoDeployDB } from './env.js';
import type { RegistroSessao, RegistroJob } from './db.js';
import {
  initSchema,
  jobsAtivos,
  obterSessao,
  semearLinhas,
  marcarJobSemeado,
  linhasPendentes,
  marcarProcessando,
  gravarResultadoLinha,
  atualizarStatusJob,
  atualizarTokensSessao,
} from './db.js';
import { GoogleAuthRest, SheetsRest, type CredenciaisApp } from './google.js';
import { montarDeps } from './deps.js';

/** Quantas linhas processar por tick (cron). Default 10; afinar pela quota do Sheets. */
const LOTE_PADRAO = 10;
/** Concorrência de linhas dentro de um lote. */
const CONCORRENCIA = 4;

/** Extrai as credenciais OAuth do app do ambiente (erro acionável se faltar). */
export function credenciaisApp(env: Env): CredenciaisApp {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI ?? '';
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'OAuth do Google não configurado: defina GOOGLE_OAUTH_CLIENT_ID, ' +
        'GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REDIRECT_URI (setAppSecret).',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Access token válido da sessão, renovando via refresh token quando perto de expirar.
 * Persiste os tokens novos no banco e atualiza o registro em memória.
 */
async function tokenValido(
  env: Env,
  db: GoDeployDB,
  sessao: RegistroSessao,
): Promise<string> {
  const margemMs = 60_000;
  if (sessao.expiraEmMs && sessao.expiraEmMs - Date.now() > margemMs) {
    return sessao.accessToken;
  }
  if (!sessao.refreshToken) {
    if (sessao.accessToken) return sessao.accessToken; // melhor esforço
    throw new Error('Sessão sem credenciais válidas; faça login novamente.');
  }
  const auth = new GoogleAuthRest(credenciaisApp(env));
  const novos = await auth.refresh(sessao.refreshToken);
  await atualizarTokensSessao(db, sessao.id, {
    accessToken: novos.accessToken,
    ...(novos.refreshToken ? { refreshToken: novos.refreshToken } : {}),
    ...(novos.expiraEmMs !== undefined ? { expiraEmMs: novos.expiraEmMs } : {}),
  });
  sessao.accessToken = novos.accessToken;
  if (novos.expiraEmMs !== undefined) sessao.expiraEmMs = novos.expiraEmMs;
  if (novos.refreshToken) sessao.refreshToken = novos.refreshToken;
  return novos.accessToken;
}

/** Cria um `SheetsClient` Workers-native ligado aos tokens (com auto-refresh) da sessão. */
export function sheetsParaSessao(
  env: Env,
  sessao: RegistroSessao,
): SheetsClient {
  return new SheetsRest(() => tokenValido(env, env.DB, sessao));
}

/** Avança todos os jobs ativos em um tick (falha isolada por job). */
export async function avancarJobs(
  env: Env,
  opts: { lote?: number } = {},
): Promise<void> {
  await initSchema(env.DB);
  const jobs = await jobsAtivos(env.DB);
  for (const job of jobs) {
    try {
      await avancarJob(env, job, opts.lote ?? LOTE_PADRAO);
    } catch (erro) {
      // Erro estrutural do job (sem sessão, planilha inacessível): marca e segue.
      await atualizarStatusJob(env.DB, job.id, 'FALHOU').catch(() => {});
    }
  }
}

/** Semeia (se preciso) e processa um lote de um job. */
async function avancarJob(env: Env, job: RegistroJob, lote: number): Promise<void> {
  const sessao = await obterSessao(env.DB, job.donoId);
  if (!sessao) {
    await atualizarStatusJob(env.DB, job.id, 'FALHOU');
    return;
  }
  const sheets = sheetsParaSessao(env, sessao);

  if (!job.semeado) {
    const leitura = await sheets.lerLinhas(job.spreadsheetId, job.aba);
    await sheets.garantirColunas(job.spreadsheetId, Object.values(COLUNAS), job.aba);
    await semearLinhas(env.DB, job.id, leitura.linhas);
    await marcarJobSemeado(env.DB, job.id);
  }

  const pendentes = await linhasPendentes(env.DB, job.id, lote);
  if (pendentes.length === 0) {
    await atualizarStatusJob(env.DB, job.id, 'CONCLUIDO');
    return;
  }

  // Anti-corrida: marca PROCESSANDO no banco e na planilha (em lote) antes de iniciar.
  await marcarProcessando(env.DB, job.id, pendentes.map((l) => l.numeroLinha));
  const marcadores: LinhaResultado[] = pendentes.map((l) => ({
    numeroLinha: l.numeroLinha,
    status: 'PROCESSANDO',
    processadoEm: agora(),
  }));
  await sheets.escreverResultados(job.spreadsheetId, marcadores, job.aba);

  // Processa o lote com concorrência limitada; `processarLinha` não lança.
  const deps = montarDeps(sheets, env);
  const resultados = await processarComConcorrencia(pendentes, CONCORRENCIA, (linha) =>
    processarLinha(linha, deps),
  );

  // Grava resultados na planilha (lote) e no banco.
  await sheets.escreverResultados(job.spreadsheetId, resultados, job.aba);
  for (const r of resultados) await gravarResultadoLinha(env.DB, job.id, r);

  // Se não sobrou nada pendente, conclui (o próximo tick também detectaria).
  const restantes = await linhasPendentes(env.DB, job.id, 1);
  if (restantes.length === 0) {
    await atualizarStatusJob(env.DB, job.id, 'CONCLUIDO');
  }
}

/** Cria o registro de um job a partir dos dados validados (usado pela rota POST). */
export function novoJob(params: {
  id: string;
  donoId: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  aba?: string;
}): Job {
  return {
    id: params.id,
    donoId: params.donoId,
    spreadsheetId: params.spreadsheetId,
    spreadsheetUrl: params.spreadsheetUrl,
    ...(params.aba ? { aba: params.aba } : {}),
    criadoEm: agora(),
    status: 'CRIADO',
  };
}
