/**
 * Persistência de **execuções de conferência** (job = perfil × mês) e de suas linhas,
 * sobre o `env.DB`. Cada tick do cron avança um job em lote; o estado fica aqui para
 * a retomada e para a devolutiva na tela (CLAUDE.md §11, spec §7).
 *
 * Idempotência do processamento em si é pela **coluna de status na planilha** (C5);
 * `conf_linhas` só acumula os resultados já calculados para o dashboard.
 */
import type { GoDeployDB } from '../../api/env.js';
import { primeiraLinha, linhasComoObjetos, comoTexto, comoInteiro } from '../../api/env.js';
import type { ResultadoConferencia, StatusConferencia, TipoFrente } from '../tipos.js';
import type { MapeamentoColunas } from '../tipos.js';
import type { ResultadoFrente, ResumoPerfil } from '../pipeline/tipos.js';

function agora(): string {
  return new Date().toISOString();
}

/** Estados de uma execução de conferência. */
export type StatusConfJob =
  | 'CRIADO'
  | 'PROCESSANDO'
  | 'AGUARDANDO_MAPEAMENTO'
  | 'CONCLUIDO'
  | 'FALHOU';

/** Pendência de confirmação de mapeamento que pausa o job (spec §6, decisão 3). */
export interface PendenciaMapeamento {
  /** Chave do cache do mapa (`perfilId:FRENTE`). */
  chave: string;
  frente: TipoFrente;
  /** Papéis (de entrada) que precisam de coluna confirmada. */
  papeis: string[];
  /** Cabeçalhos do formulário (para o usuário escolher a coluna). */
  cabecalhos: string[];
  /** O que a IA propôs (papel → {coluna, confianca}). */
  proposto: MapeamentoColunas;
}

export interface ConfJob {
  id: string;
  perfilId: string;
  mesAlvo: string;
  formSheetUrl: string;
  status: StatusConfJob;
  pendenciaMapa?: PendenciaMapeamento;
  erro?: string;
  criadoEm: string;
  atualizadoEm: string;
}

function parse<T>(texto: string, fallback: T): T {
  if (!texto) return fallback;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return fallback;
  }
}

function mapearJob(linha: Record<string, unknown>): ConfJob {
  const pend = comoTexto(linha['pendencia_mapa']);
  const pendObj = pend ? parse<PendenciaMapeamento | undefined>(pend, undefined) : undefined;
  const erro = comoTexto(linha['erro']);
  return {
    id: comoTexto(linha['id']),
    perfilId: comoTexto(linha['perfil_id']),
    mesAlvo: comoTexto(linha['mes_alvo']),
    formSheetUrl: comoTexto(linha['form_sheet_url']),
    status: comoTexto(linha['status']) as StatusConfJob,
    ...(pendObj ? { pendenciaMapa: pendObj } : {}),
    ...(erro ? { erro } : {}),
    criadoEm: comoTexto(linha['criado_em']),
    atualizadoEm: comoTexto(linha['atualizado_em']),
  };
}

export async function criarConfJob(
  db: GoDeployDB,
  job: { id: string; perfilId: string; mesAlvo: string; formSheetUrl: string },
): Promise<void> {
  const ts = agora();
  await db.exec(
    `INSERT INTO conf_jobs (id, perfil_id, mes_alvo, form_sheet_url, status, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, 'CRIADO', ?, ?)`,
    [job.id, job.perfilId, job.mesAlvo, job.formSheetUrl, ts, ts],
  );
}

export async function obterConfJob(db: GoDeployDB, id: string): Promise<ConfJob | undefined> {
  const res = await db.query('SELECT * FROM conf_jobs WHERE id = ?', [id]);
  const linha = primeiraLinha(res);
  return linha ? mapearJob(linha) : undefined;
}

/** Jobs ainda ativos (alvo do cron). `AGUARDANDO_MAPEAMENTO` fica fora (espera o usuário). */
export async function confJobsAtivos(db: GoDeployDB): Promise<ConfJob[]> {
  const res = await db.query(
    `SELECT * FROM conf_jobs WHERE status IN ('CRIADO', 'PROCESSANDO') ORDER BY criado_em ASC`,
  );
  return linhasComoObjetos(res).map(mapearJob);
}

export async function atualizarStatusConfJob(
  db: GoDeployDB,
  id: string,
  status: StatusConfJob,
  extra: { erro?: string; pendencia?: PendenciaMapeamento | null } = {},
): Promise<void> {
  const pendencia =
    extra.pendencia === undefined ? undefined : extra.pendencia === null ? null : JSON.stringify(extra.pendencia);
  // Atualiza pendência/erro só quando explicitamente informados (undefined = preserva).
  if (pendencia !== undefined && extra.erro !== undefined) {
    await db.exec(
      `UPDATE conf_jobs SET status = ?, pendencia_mapa = ?, erro = ?, atualizado_em = ? WHERE id = ?`,
      [status, pendencia, extra.erro, agora(), id],
    );
  } else if (pendencia !== undefined) {
    await db.exec(
      `UPDATE conf_jobs SET status = ?, pendencia_mapa = ?, atualizado_em = ? WHERE id = ?`,
      [status, pendencia, agora(), id],
    );
  } else if (extra.erro !== undefined) {
    await db.exec(
      `UPDATE conf_jobs SET status = ?, erro = ?, atualizado_em = ? WHERE id = ?`,
      [status, extra.erro, agora(), id],
    );
  } else {
    await db.exec(`UPDATE conf_jobs SET status = ?, atualizado_em = ? WHERE id = ?`, [
      status,
      agora(),
      id,
    ]);
  }
}

/** Persiste (upsert) os resultados de uma frente em `conf_linhas` para o dashboard. */
export async function gravarLinhasConferencia(
  db: GoDeployDB,
  jobId: string,
  frente: TipoFrente,
  resultados: readonly ResultadoConferencia[],
): Promise<void> {
  const ts = agora();
  for (const r of resultados) {
    await db.exec(
      `INSERT INTO conf_linhas
         (job_id, frente, cupom, numero_linha_form, status, valor_nf_centavos,
          valor_esperado_centavos, retroativo_centavos, erro, processado_em)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id, frente, cupom) DO UPDATE SET
         status = excluded.status,
         valor_nf_centavos = excluded.valor_nf_centavos,
         valor_esperado_centavos = excluded.valor_esperado_centavos,
         retroativo_centavos = excluded.retroativo_centavos,
         erro = excluded.erro,
         processado_em = excluded.processado_em`,
      [
        jobId,
        frente,
        r.cupom,
        r.status,
        r.valorNfCentavos ?? 0,
        r.valorEsperadoCentavos,
        r.retroativoCentavos,
        r.erro ?? null,
        ts,
      ],
    );
  }
}

/** Devolutiva agregada de um job (a tela). Conta por status, exclui SOMA do total. */
export interface ProgressoConferencia {
  jobId: string;
  perfilId: string;
  mesAlvo: string;
  status: StatusConfJob;
  /** Status (enum) → contagem, considerando só as frentes de extração (sem SOMA). */
  porStatus: Partial<Record<StatusConferencia, number>>;
  /** Total de cupons conferidos (sem SOMA). */
  total: number;
  /** Reconciliações feitas pela SOMA (cupons cujo status melhorou). */
  ajustesSoma: number;
  erro?: string;
  pendenciaMapa?: PendenciaMapeamento;
  atualizadoEm: string;
}

export async function progressoConfJob(
  db: GoDeployDB,
  jobId: string,
): Promise<ProgressoConferencia | undefined> {
  const job = await obterConfJob(db, jobId);
  if (!job) return undefined;

  const res = await db.query(
    `SELECT frente, status, COUNT(*) AS n FROM conf_linhas WHERE job_id = ? GROUP BY frente, status`,
    [jobId],
  );

  const porStatus: Partial<Record<StatusConferencia, number>> = {};
  let total = 0;
  let ajustesSoma = 0;
  for (const linha of linhasComoObjetos(res)) {
    const frente = comoTexto(linha['frente']) as TipoFrente;
    const status = comoTexto(linha['status']) as StatusConferencia;
    const n = comoInteiro(linha['n']);
    if (frente === 'SOMA') {
      ajustesSoma += n;
      continue;
    }
    porStatus[status] = (porStatus[status] ?? 0) + n;
    total += n;
  }

  return {
    jobId,
    perfilId: job.perfilId,
    mesAlvo: job.mesAlvo,
    status: job.status,
    porStatus,
    total,
    ajustesSoma,
    ...(job.erro ? { erro: job.erro } : {}),
    ...(job.pendenciaMapa ? { pendenciaMapa: job.pendenciaMapa } : {}),
    atualizadoEm: job.atualizadoEm,
  };
}

/**
 * Decide o próximo status do job a partir do resumo de um tick (função **pura**):
 *  - alguma frente pediu confirmação de mapeamento → `AGUARDANDO_MAPEAMENTO`;
 *  - nenhuma frente de extração (INFLUS/ASSESSORIA/EMBAIXADOR) processou cupom → `CONCLUIDO`
 *    (a planilha não tem mais pendências — a idempotência da C5 garante a parada);
 *  - senão → `PROCESSANDO` (o próximo tick continua o lote).
 */
export function decidirStatusJob(resumo: ResumoPerfil): {
  status: 'AGUARDANDO_MAPEAMENTO' | 'CONCLUIDO' | 'PROCESSANDO';
  frenteParaConfirmar?: TipoFrente;
} {
  const pendente = resumo.frentes.find((f: ResultadoFrente) => f.precisaConfirmarMapeamento);
  if (pendente) return { status: 'AGUARDANDO_MAPEAMENTO', frenteParaConfirmar: pendente.frente };

  const processou = resumo.frentes
    .filter((f) => f.frente !== 'SOMA')
    .some((f) => f.resultados.length > 0);
  return { status: processou ? 'PROCESSANDO' : 'CONCLUIDO' };
}
