/**
 * Repositório sobre o `env.DB` (SQLite embutido do GoDeploy).
 *
 * Substitui a `FilaEmMemoria` da F5 no runtime stateless do Workers (CLAUDE.md §11):
 * o estado de job/linha **persiste** aqui e o cron avança em lotes. O contrato
 * `JobQueue` da F0 segue válido; esta é a implementação de produção.
 */
import type {
  Job,
  StatusJob,
  StatusLinha,
  ProgressoJob,
  LinhaEntrada,
  LinhaResultado,
} from '../types/index.js';
import type { Env, GoDeployDB } from './env.js';
import { linhasComoObjetos, primeiraLinha, comoTexto, comoInteiro } from './env.js';

/** Sessão do usuário (tokens OAuth guardados no banco; nunca no cookie). */
export interface RegistroSessao {
  id: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiraEmMs?: number;
}

function agora(): string {
  return new Date().toISOString();
}

/** Cria as tabelas se ainda não existirem (idempotente — roda a cada request/tick). */
export async function initSchema(db: GoDeployDB): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS sessoes (
       id TEXT PRIMARY KEY,
       email TEXT NOT NULL DEFAULT '',
       access_token TEXT NOT NULL DEFAULT '',
       refresh_token TEXT,
       expira_em_ms INTEGER,
       criado_em TEXT NOT NULL
     )`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS jobs (
       id TEXT PRIMARY KEY,
       sessao_id TEXT NOT NULL,
       spreadsheet_id TEXT NOT NULL,
       spreadsheet_url TEXT NOT NULL,
       aba TEXT,
       status TEXT NOT NULL,
       semeado INTEGER NOT NULL DEFAULT 0,
       criado_em TEXT NOT NULL,
       atualizado_em TEXT NOT NULL
     )`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS linhas (
       job_id TEXT NOT NULL,
       numero_linha INTEGER NOT NULL,
       link TEXT NOT NULL DEFAULT '',
       status TEXT NOT NULL,
       valor_centavos INTEGER NOT NULL DEFAULT 0,
       erro TEXT,
       processado_em TEXT,
       PRIMARY KEY (job_id, numero_linha)
     )`,
  );
}

// --- Sessões -----------------------------------------------------------------

export async function salvarSessao(
  db: GoDeployDB,
  s: RegistroSessao,
): Promise<void> {
  await db.exec(
    `INSERT INTO sessoes (id, email, access_token, refresh_token, expira_em_ms, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, sessoes.refresh_token),
       expira_em_ms = excluded.expira_em_ms`,
    [
      s.id,
      s.email,
      s.accessToken,
      s.refreshToken ?? null,
      s.expiraEmMs ?? null,
      agora(),
    ],
  );
}

export async function obterSessao(
  db: GoDeployDB,
  id: string,
): Promise<RegistroSessao | undefined> {
  const res = await db.query(
    `SELECT id, email, access_token, refresh_token, expira_em_ms FROM sessoes WHERE id = ?`,
    [id],
  );
  const linha = primeiraLinha(res);
  if (!linha) return undefined;
  const refresh = comoTexto(linha['refresh_token']);
  const expira = linha['expira_em_ms'];
  return {
    id: comoTexto(linha['id']),
    email: comoTexto(linha['email']),
    accessToken: comoTexto(linha['access_token']),
    ...(refresh ? { refreshToken: refresh } : {}),
    ...(expira !== null && expira !== undefined
      ? { expiraEmMs: comoInteiro(expira) }
      : {}),
  };
}

/** Atualiza os tokens após um refresh (preserva o refresh token se o Google não devolver outro). */
export async function atualizarTokensSessao(
  db: GoDeployDB,
  id: string,
  tokens: { accessToken: string; refreshToken?: string; expiraEmMs?: number },
): Promise<void> {
  await db.exec(
    `UPDATE sessoes SET
       access_token = ?,
       refresh_token = COALESCE(?, refresh_token),
       expira_em_ms = ?
     WHERE id = ?`,
    [tokens.accessToken, tokens.refreshToken ?? null, tokens.expiraEmMs ?? null, id],
  );
}

// --- Jobs --------------------------------------------------------------------

export async function criarJob(db: GoDeployDB, job: Job): Promise<void> {
  await db.exec(
    `INSERT INTO jobs (id, sessao_id, spreadsheet_id, spreadsheet_url, aba, status, semeado, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      job.id,
      job.donoId,
      job.spreadsheetId,
      job.spreadsheetUrl,
      job.aba ?? null,
      job.status,
      job.criadoEm,
      job.criadoEm,
    ],
  );
}

/** Job persistido + flag de semeado (linhas já carregadas da planilha?). */
export interface RegistroJob extends Job {
  semeado: boolean;
}

function mapearJob(linha: Record<string, unknown>): RegistroJob {
  const aba = comoTexto(linha['aba']);
  return {
    id: comoTexto(linha['id']),
    donoId: comoTexto(linha['sessao_id']),
    spreadsheetId: comoTexto(linha['spreadsheet_id']),
    spreadsheetUrl: comoTexto(linha['spreadsheet_url']),
    ...(aba ? { aba } : {}),
    status: comoTexto(linha['status']) as StatusJob,
    criadoEm: comoTexto(linha['criado_em']),
    semeado: comoInteiro(linha['semeado']) === 1,
  };
}

export async function obterJob(
  db: GoDeployDB,
  id: string,
): Promise<RegistroJob | undefined> {
  const res = await db.query(`SELECT * FROM jobs WHERE id = ?`, [id]);
  const linha = primeiraLinha(res);
  return linha ? mapearJob(linha) : undefined;
}

/** Jobs ainda ativos (não concluídos/falhos/cancelados) — alvo do cron. */
export async function jobsAtivos(db: GoDeployDB): Promise<RegistroJob[]> {
  const res = await db.query(
    `SELECT * FROM jobs WHERE status IN ('CRIADO', 'PROCESSANDO') ORDER BY criado_em ASC`,
  );
  return linhasComoObjetos(res).map(mapearJob);
}

export async function atualizarStatusJob(
  db: GoDeployDB,
  id: string,
  status: StatusJob,
): Promise<void> {
  await db.exec(`UPDATE jobs SET status = ?, atualizado_em = ? WHERE id = ?`, [
    status,
    agora(),
    id,
  ]);
}

export async function marcarJobSemeado(
  db: GoDeployDB,
  id: string,
): Promise<void> {
  await db.exec(
    `UPDATE jobs SET semeado = 1, status = 'PROCESSANDO', atualizado_em = ? WHERE id = ?`,
    [agora(), id],
  );
}

// --- Linhas ------------------------------------------------------------------

/** Semeia as linhas lidas da planilha (idempotente — não duplica em reprocesso). */
export async function semearLinhas(
  db: GoDeployDB,
  jobId: string,
  linhas: readonly LinhaEntrada[],
): Promise<void> {
  for (const l of linhas) {
    const status: StatusLinha = l.statusAtual === 'CONCLUIDO' ? 'CONCLUIDO' : 'PENDENTE';
    await db.exec(
      `INSERT INTO linhas (job_id, numero_linha, link, status)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(job_id, numero_linha) DO NOTHING`,
      [jobId, l.numeroLinha, l.linkArquivo, status],
    );
  }
}

/** Próximo lote de linhas PENDENTE de um job (ordem estável por número de linha). */
export async function linhasPendentes(
  db: GoDeployDB,
  jobId: string,
  limite: number,
): Promise<LinhaEntrada[]> {
  const res = await db.query(
    `SELECT numero_linha, link FROM linhas
     WHERE job_id = ? AND status = 'PENDENTE'
     ORDER BY numero_linha ASC
     LIMIT ?`,
    [jobId, Math.max(1, limite)],
  );
  return linhasComoObjetos(res).map((linha) => ({
    numeroLinha: comoInteiro(linha['numero_linha']),
    linkArquivo: comoTexto(linha['link']),
  }));
}

/** Marca um conjunto de linhas como PROCESSANDO (anti-corrida, antes de processar). */
export async function marcarProcessando(
  db: GoDeployDB,
  jobId: string,
  numeros: readonly number[],
): Promise<void> {
  for (const numero of numeros) {
    await db.exec(
      `UPDATE linhas SET status = 'PROCESSANDO' WHERE job_id = ? AND numero_linha = ?`,
      [jobId, numero],
    );
  }
}

/** Grava o resultado final de uma linha (status + valor + erro + timestamp). */
export async function gravarResultadoLinha(
  db: GoDeployDB,
  jobId: string,
  r: LinhaResultado,
): Promise<void> {
  await db.exec(
    `UPDATE linhas SET status = ?, valor_centavos = ?, erro = ?, processado_em = ?
     WHERE job_id = ? AND numero_linha = ?`,
    [
      r.status,
      r.status === 'CONCLUIDO' ? r.nota?.valorTotalCentavos ?? 0 : 0,
      r.erro ?? null,
      r.processadoEm,
      jobId,
      r.numeroLinha,
    ],
  );
}

/** Agrega o estado das linhas em um `ProgressoJob` (a devolutiva na tela). */
export async function progressoJob(
  db: GoDeployDB,
  jobId: string,
): Promise<ProgressoJob | undefined> {
  const job = await obterJob(db, jobId);
  if (!job) return undefined;

  const res = await db.query(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(valor_centavos), 0) AS soma
     FROM linhas WHERE job_id = ? GROUP BY status`,
    [jobId],
  );

  let total = 0;
  let pendentes = 0;
  let processando = 0;
  let concluidos = 0;
  let erros = 0;
  let valorTotalCentavos = 0;

  for (const linha of linhasComoObjetos(res)) {
    const status = comoTexto(linha['status']) as StatusLinha;
    const n = comoInteiro(linha['n']);
    total += n;
    switch (status) {
      case 'PENDENTE':
        pendentes += n;
        break;
      case 'PROCESSANDO':
        processando += n;
        break;
      case 'CONCLUIDO':
        concluidos += n;
        valorTotalCentavos += comoInteiro(linha['soma']);
        break;
      case 'ERRO':
        erros += n;
        break;
    }
  }

  return {
    jobId,
    status: job.status,
    total,
    pendentes,
    processando,
    concluidos,
    erros,
    valorTotalCentavos,
    atualizadoEm: agora(),
  };
}

/** Conveniência: garante o schema a partir do `Env`. */
export async function prepararBanco(env: Env): Promise<void> {
  await initSchema(env.DB);
}
