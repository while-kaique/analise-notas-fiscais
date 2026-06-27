/**
 * Sistema de logs estruturados — v2.
 *
 * Workers-safe (só `console`, `Date`, `JSON`): roda igual no GoDeploy (que captura o
 * `console` por request) e localmente (o `src/local/server.ts` formata bonito e a gente
 * dá `tail`). Sem dependência externa.
 *
 * **Níveis:** debug < info < warn < error. O mínimo vem de `configurarLog` (env
 * `LOG_LEVEL`); abaixo dele a linha é descartada barata.
 *
 * **PII / dados fiscais (CLAUDE.md §6):** NUNCA passe conteúdo de NF (valores, CNPJ,
 * número da nota, texto do OCR) nos campos. Logue identificadores operacionais (cupom,
 * fileId, status, contagens, durações) e nomes de coluna — nunca o conteúdo fiscal.
 */

export type NivelLog = 'debug' | 'info' | 'warn' | 'error';

const PESO: Readonly<Record<NivelLog, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Campos estruturados anexados a uma entrada de log. */
export type CamposLog = Record<string, unknown>;

interface ConfigLog {
  nivelMin: number;
  pretty: boolean;
}

const config: ConfigLog = { nivelMin: PESO.info, pretty: false };

/** Configura o log (idempotente). Chamada no boot do worker/servidor. */
export function configurarLog(opts: { level?: string | undefined; pretty?: boolean | undefined }): void {
  const nivel = (opts.level ?? '').toLowerCase();
  if (nivel && nivel in PESO) config.nivelMin = PESO[nivel as NivelLog];
  if (opts.pretty !== undefined) config.pretty = opts.pretty;
}

export interface Logger {
  debug(msg: string, campos?: CamposLog): void;
  info(msg: string, campos?: CamposLog): void;
  warn(msg: string, campos?: CamposLog): void;
  error(msg: string, campos?: CamposLog): void;
  /** Novo logger com campos fixos herdados (ex.: `{ job, frente }`). */
  filho(campos: CamposLog): Logger;
}

const CORES: Readonly<Record<NivelLog, string>> = {
  debug: '\x1b[90m', // cinza
  info: '\x1b[36m', // ciano
  warn: '\x1b[33m', // amarelo
  error: '\x1b[31m', // vermelho
};
const RESET = '\x1b[0m';

function formatarPretty(nivel: NivelLog, ts: string, msg: string, campos: CamposLog): string {
  const hora = ts.slice(11, 23); // HH:MM:SS.mmm
  const extras = Object.entries(campos)
    .map(([k, v]) => `${k}=${formatarValor(v)}`)
    .join(' ');
  const tag = `${CORES[nivel]}${nivel.toUpperCase().padEnd(5)}${RESET}`;
  return `${hora} ${tag} ${msg}${extras ? '  ' + extras : ''}`;
}

function formatarValor(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v.length > 120 ? JSON.stringify(v.slice(0, 117) + '…') : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function emitir(nivel: NivelLog, base: CamposLog, msg: string, campos?: CamposLog): void {
  if (PESO[nivel] < config.nivelMin) return;
  const ts = new Date().toISOString();
  const dados: CamposLog = { ...base, ...(campos ?? {}) };
  const linha = config.pretty
    ? formatarPretty(nivel, ts, msg, dados)
    : JSON.stringify({ ts, nivel, msg, ...dados });
  // warn/error → stderr; resto → stdout. (GoDeploy captura ambos por request.)
  if (nivel === 'warn' || nivel === 'error') console.error(linha);
  else console.log(linha);
}

function criar(base: CamposLog): Logger {
  return {
    debug: (msg, campos) => emitir('debug', base, msg, campos),
    info: (msg, campos) => emitir('info', base, msg, campos),
    warn: (msg, campos) => emitir('warn', base, msg, campos),
    error: (msg, campos) => emitir('error', base, msg, campos),
    filho: (campos) => criar({ ...base, ...campos }),
  };
}

/** Logger raiz. Use `log.filho({...})` para contexto (job, frente, request). */
export const log: Logger = criar({});

/** Extrai mensagem de erro de forma segura (sem vazar objetos estranhos). */
export function msgErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Stack do erro (ou a mensagem), para logs de nível error. */
export function stackErro(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}
