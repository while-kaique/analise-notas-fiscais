/**
 * Orquestração das execuções de conferência no runtime stateless (cron + `env.DB`).
 *
 * `avancarConfJobs` é chamada a cada tick do cron: para cada job ativo, roda um lote do
 * `processarPerfil` (C5), persiste os resultados e decide o próximo status (continuar,
 * concluir ou pausar pedindo confirmação de mapeamento). Falha isolada por job
 * (CLAUDE.md §3): um job que estoura vira `FALHOU` e não derruba os demais.
 */
import type { Env } from './env.js';
import type { Perfil, TipoFrente, PapelColunaEntrada, MapeamentoColunas } from '../conferencia/index.js';
import { ROTULO_STATUS } from '../conferencia/index.js';
import { processarPerfil, refDoFormUrl } from '../conferencia/pipeline/index.js';
import type { ResultadoFrente } from '../conferencia/pipeline/index.js';
import { extrairSpreadsheetId } from '../sheets/spreadsheet-id.js';
import {
  criarConfJob,
  obterConfJob,
  confJobsAtivos,
  atualizarStatusConfJob,
  gravarLinhasConferencia,
  registrarAtividades,
  decidirStatusJob,
  type ConfJob,
  type NovaAtividade,
  type PendenciaMapeamento,
} from '../conferencia/persistencia/jobs-db.js';
import {
  montarDepsConferencia,
  montarRepo,
  loteConferencia,
  type DepsConferencia,
} from './conferencia-deps.js';
import { log, msgErro, stackErro } from '../obs/log.js';

/** `papelLinkNf` → papel de coluna de entrada (igual ao usado no pipeline). */
const PAPEL_LINK_ENTRADA: Readonly<Record<string, PapelColunaEntrada>> = {
  influencer: 'linkNf_influencer',
  assessoria: 'linkNf_assessoria',
  unica: 'linkNf_unica',
};

/** Rótulo curto de cada frente para o feed de atividades (a tela). */
const ROTULO_FRENTE: Readonly<Record<TipoFrente, string>> = {
  INFLUS: 'Influenciadores',
  ASSESSORIA: 'Assessoria',
  EMBAIXADOR: 'Embaixadores',
  SOMA: 'Soma (influ + assessoria)',
};

/**
 * Deriva os eventos do feed a partir do resumo de um tick — um por cupom conferido,
 * mais um marcador por frente. **Sem PII** (§6): só cupom, frente e status; nunca
 * valor/CNPJ/nº/texto da NF.
 */
export function atividadesDoResumo(frentes: readonly ResultadoFrente[]): NovaAtividade[] {
  const eventos: NovaAtividade[] = [];
  for (const f of frentes) {
    if (f.resultados.length === 0) continue;
    const rotuloFrente = ROTULO_FRENTE[f.frente] ?? f.frente;
    const ehSoma = f.frente === 'SOMA';
    for (const r of f.resultados) {
      const cupom = r.cupomOriginal || r.cupom;
      const rotuloStatus = ROTULO_STATUS[r.status] ?? r.status;
      const sufixoErro = r.erro ? ` — ${r.erro}` : '';
      eventos.push({
        frente: f.frente,
        cupom,
        tipo: ehSoma ? 'soma' : 'cupom',
        status: r.status,
        mensagem: `${rotuloFrente} · cupom ${cupom} → ${rotuloStatus}${sufixoErro}`,
      });
    }
    eventos.push({
      frente: f.frente,
      tipo: 'frente_concluida',
      mensagem: `${rotuloFrente}: ${f.resultados.length} cupom(ns) neste lote.`,
    });
  }
  return eventos;
}

/** Papéis de entrada críticos de uma frente do perfil (p/ a UI de confirmação). */
function papeisEntradaFrente(perfil: Perfil, frenteTipo: TipoFrente): string[] {
  const papeis: string[] = ['cupom'];
  const frente = perfil.frentes.find((f) => f.tipo === frenteTipo);
  if (frente?.papelLinkNf) papeis.push(PAPEL_LINK_ENTRADA[frente.papelLinkNf] ?? 'linkNf_unica');
  return papeis;
}

/** Avança todos os jobs ativos em um tick (falha isolada por job). */
export async function avancarConfJobs(env: Env): Promise<void> {
  const deps = montarDepsConferencia(env);
  await deps.repo.inicializar();
  const jobs = await confJobsAtivos(env.DB);
  if (jobs.length === 0) {
    log.debug('cron tick: nenhum job ativo');
    return;
  }
  log.info('cron tick', { jobsAtivos: jobs.length });
  for (const job of jobs) {
    try {
      await avancarConfJob(env, job, deps);
    } catch (e) {
      log.error('job falhou', { job: job.id, perfil: job.perfilId, erro: stackErro(e) });
      await atualizarStatusConfJob(env.DB, job.id, 'FALHOU', { erro: msgErro(e) }).catch(() => {});
      await registrarAtividades(env.DB, job.id, [
        { tipo: 'job_falhou', mensagem: `A conferência falhou: ${msgErro(e)}` },
      ]).catch(() => {});
    }
  }
}

async function avancarConfJob(env: Env, job: ConfJob, deps: DepsConferencia): Promise<void> {
  const jlog = log.filho({ job: job.id });
  const inicio = Date.now();
  const perfil = await deps.repo.obterPerfil(job.perfilId);
  if (!perfil) {
    await atualizarStatusConfJob(env.DB, job.id, 'FALHOU', {
      erro: `Perfil não encontrado: ${job.perfilId}.`,
    });
    return;
  }
  const marca = await deps.repo.obterMarca(perfil.marcaId);
  if (!marca) {
    await atualizarStatusConfJob(env.DB, job.id, 'FALHOU', {
      erro: `Marca não encontrada: ${perfil.marcaId}.`,
    });
    return;
  }

  if (job.status === 'CRIADO') {
    await atualizarStatusConfJob(env.DB, job.id, 'PROCESSANDO');
    await registrarAtividades(env.DB, job.id, [
      {
        tipo: 'job_iniciado',
        mensagem: `Conferência iniciada — ${perfil.nome} · ${job.mesAlvo}. Lendo a planilha e cruzando os cupons…`,
      },
    ]);
  }

  jlog.info('avançando job', { perfil: perfil.nome, marca: marca.nome, mes: job.mesAlvo });

  // Usa o link do formulário do PRÓPRIO job (decisão 4: 1 form por perfil, trocado/mês).
  const perfilComForm: Perfil = { ...perfil, formSheetUrl: job.formSheetUrl };
  const resumo = await processarPerfil(perfilComForm, marca, job.mesAlvo, deps, {
    batchLimit: loteConferencia(env),
  });

  for (const f of resumo.frentes) {
    if (f.resultados.length > 0) {
      await gravarLinhasConferencia(env.DB, job.id, f.frente, f.resultados);
    }
    jlog.info('frente concluída', {
      frente: f.frente,
      cupons: f.resultados.length,
      confirmarMapa: f.precisaConfirmarMapeamento,
      origemMapa: f.origemMapa,
    });
  }

  // Feed da tela: um evento por cupom conferido + marcadores de frente (sem PII, §6).
  await registrarAtividades(env.DB, job.id, atividadesDoResumo(resumo.frentes));

  const decisao = decidirStatusJob(resumo);
  if (decisao.status === 'AGUARDANDO_MAPEAMENTO' && decisao.frenteParaConfirmar) {
    const pendencia = await montarPendencia(deps, perfilComForm, decisao.frenteParaConfirmar);
    await atualizarStatusConfJob(env.DB, job.id, 'AGUARDANDO_MAPEAMENTO', { pendencia });
    await registrarAtividades(env.DB, job.id, [
      {
        frente: decisao.frenteParaConfirmar,
        tipo: 'aguardando_mapeamento',
        mensagem: `Aguardando você confirmar as colunas da frente ${ROTULO_FRENTE[decisao.frenteParaConfirmar] ?? decisao.frenteParaConfirmar}.`,
      },
    ]);
    jlog.warn('job pausado: aguardando confirmação de mapeamento', { frente: decisao.frenteParaConfirmar });
    return;
  }
  await atualizarStatusConfJob(env.DB, job.id, decisao.status, { pendencia: null });
  if (decisao.status === 'CONCLUIDO') {
    await registrarAtividades(env.DB, job.id, [
      { tipo: 'job_concluido', mensagem: 'Conferência concluída — nada mais a processar.' },
    ]);
  }
  jlog.info('job avançado', { status: decisao.status, ms: Date.now() - inicio });
}

/** Monta o payload de confirmação: cabeçalhos do form + mapa proposto pela IA + papéis. */
async function montarPendencia(
  deps: DepsConferencia,
  perfil: Perfil,
  frente: TipoFrente,
): Promise<PendenciaMapeamento> {
  const chave = `${perfil.id}:${frente}`;
  const formRef = refDoFormUrl(perfil.formSheetUrl);
  const cabecalhos = formRef ? await deps.leitor.lerCabecalho(formRef).catch(() => []) : [];
  const proposto = (await deps.repo.obterMapeamento(chave)) ?? {};
  return { chave, frente, papeis: papeisEntradaFrente(perfil, frente), cabecalhos, proposto };
}

/** Cria uma execução de conferência (perfil + mês + link do formulário do mês). */
export async function criarConferencia(
  env: Env,
  entrada: { perfilId: string; mesAlvo: string; formUrl: string },
): Promise<{ jobId: string }> {
  const perfilId = entrada.perfilId.trim();
  const mesAlvo = entrada.mesAlvo.trim();
  const formUrl = entrada.formUrl.trim();

  if (!/^\d{2}\/\d{4}$/.test(mesAlvo)) {
    throw new Error('Mês/Ano inválido. Use o formato MM/AAAA (ex.: 05/2026).');
  }
  if (!extrairSpreadsheetId(formUrl)) {
    throw new Error('Link do formulário inválido. Cole a URL do Google Sheets de respostas.');
  }

  const repo = montarRepo(env);
  await repo.inicializar();
  const perfil = await repo.obterPerfil(perfilId);
  if (!perfil) throw new Error(`Perfil não encontrado: ${perfilId}.`);

  // Salva o link do mês no perfil (substitui o anterior — decisão 4).
  await repo.atualizarFormUrl(perfilId, formUrl);

  const jobId = crypto.randomUUID();
  await criarConfJob(env.DB, { id: jobId, perfilId, mesAlvo, formSheetUrl: formUrl });
  log.info('conferência criada', { job: jobId, perfil: perfil.nome, mes: mesAlvo });
  return { jobId };
}

/**
 * Confirma o mapeamento de colunas de uma frente (a UI quando a IA ficou incerta).
 * Grava o mapa com confiança 1 (humano confirmou) e religa o job para `PROCESSANDO`.
 */
export async function confirmarMapeamento(
  env: Env,
  jobId: string,
  entrada: { frente: TipoFrente; mapeamento: Record<string, string> },
): Promise<void> {
  const job = await obterConfJob(env.DB, jobId);
  if (!job) throw new Error(`Job não encontrado: ${jobId}.`);

  const mapa: MapeamentoColunas = {};
  for (const [papel, coluna] of Object.entries(entrada.mapeamento)) {
    const nome = coluna.trim();
    if (nome !== '') mapa[papel] = { coluna: nome, confianca: 1 };
  }
  if (Object.keys(mapa).length === 0) {
    throw new Error('Informe ao menos uma coluna para confirmar o mapeamento.');
  }

  const repo = montarRepo(env);
  await repo.inicializar();
  await repo.salvarMapeamento(`${job.perfilId}:${entrada.frente}`, mapa);
  await atualizarStatusConfJob(env.DB, jobId, 'PROCESSANDO', { pendencia: null });
}
