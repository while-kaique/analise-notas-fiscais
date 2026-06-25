/**
 * Tipos do runtime do GoDeploy / Cloudflare Workers.
 *
 * Declarados **localmente** de propósito (CLAUDE.md §11 — decisão de plataforma):
 * assim o `tsc` do gate (`npm run typecheck`) compila sem exigir
 * `@cloudflare/workers-types`, e a F6 não adiciona nenhuma dependência externa.
 * `Request`/`Response`/`fetch`/`crypto`/`URL` vêm dos globals (Node 20 / Workers).
 */

/** Resultado de um SELECT no `env.DB` (SQLite embutido do GoDeploy). */
export interface ResultadoQuery {
  columns: string[];
  /** Cada linha pode vir como array (alinhado a `columns`) ou objeto — ver {@link linhasComoObjetos}. */
  rows: unknown[];
  rowsRead: number;
}

/** Resultado de uma escrita no `env.DB`. */
export interface ResultadoExec {
  rowsWritten: number;
}

/** Banco SQLite embutido exposto pelo GoDeploy como `env.DB`. */
export interface GoDeployDB {
  query(sql: string, params?: readonly unknown[]): Promise<ResultadoQuery>;
  exec(sql: string, params?: readonly unknown[]): Promise<ResultadoExec>;
}

/** Variáveis de ambiente + bindings do Worker (segredos via `setAppSecret`). */
export interface Env {
  DB: GoDeployDB;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  /** Segredo p/ assinar o cookie de sessão (HMAC). */
  SESSION_SECRET?: string;
  /** Quantas linhas o cron processa por tick (default 10). */
  PROCESS_BATCH_SIZE?: string;
  /** Chave injetada pela plataforma p/ autenticar a chamada do cron (POST /tasks/*). */
  GODEPLOY_CRON_KEY?: string;
}

/** Contexto de execução do Worker (subset usado aqui). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

/**
 * Normaliza o retorno do `env.DB.query` para uma lista de objetos `coluna→valor`,
 * funcionando tanto se `rows` vier como arrays (zip com `columns`) quanto como objetos.
 * Defensivo de propósito: o formato exato de `rows` não é garantido pelo contrato.
 */
export function linhasComoObjetos(
  res: ResultadoQuery,
): Record<string, unknown>[] {
  return res.rows.map((linha) => {
    if (Array.isArray(linha)) {
      const obj: Record<string, unknown> = {};
      res.columns.forEach((coluna, i) => {
        obj[coluna] = linha[i];
      });
      return obj;
    }
    return (linha ?? {}) as Record<string, unknown>;
  });
}

/** Primeira linha do resultado como objeto, ou `undefined` se vazio. */
export function primeiraLinha(
  res: ResultadoQuery,
): Record<string, unknown> | undefined {
  return linhasComoObjetos(res)[0];
}

/** Lê um campo como string (coerção segura; `undefined`/`null` → ''). */
export function comoTexto(valor: unknown): string {
  return valor === undefined || valor === null ? '' : String(valor);
}

/** Lê um campo como inteiro (coerção segura; inválido → 0). */
export function comoInteiro(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(comoTexto(valor));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
