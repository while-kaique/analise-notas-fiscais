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

/**
 * Banco SQLite embutido exposto pelo GoDeploy como `env.DB`.
 *
 * `params` é **obrigatório** (passe `[]` quando não houver bind): o runtime do GoDeploy
 * itera sobre o argumento e estoura `params is not iterable` se ele vier `undefined`.
 * Tipá-lo como obrigatório faz o `tsc` (gate) barrar qualquer chamada sem params.
 */
export interface GoDeployDB {
  query(sql: string, params: readonly unknown[]): Promise<ResultadoQuery>;
  exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec>;
}

/**
 * Variáveis de ambiente + bindings do Worker (segredos via `setAppSecret`).
 *
 * No v2 (conferência por cupom) a identidade que acessa Drive/Sheets é a `rpa_ia`
 * via **refresh token** (decisão 11): `GOOGLE_OAUTH_CLIENT_ID/SECRET` são do app OAuth
 * da rpa_ia e `GOOGLE_OAUTH_REFRESH_TOKEN` é o consentimento offline. Não há login de
 * usuário na UI (acesso gated pelo GoDeploy `authenticated`).
 */
export interface Env {
  DB: GoDeployDB;
  // --- Identidade de serviço (rpa_ia) — Drive + Sheets (decisão 11) ---
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** Refresh token de longa duração da rpa_ia (consentimento offline 1x). */
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  /** Redirect URI do app OAuth da rpa_ia (usado só p/ gerar a URL de consentimento). */
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  /** Segredo p/ assinar o cookie de sessão (HMAC) — opcional, controle interno. */
  SESSION_SECRET?: string;
  /** Quantos cupons o cron processa por frente a cada tick (default 25). */
  CONF_BATCH_SIZE?: string;
  /** Chave injetada pela plataforma p/ autenticar a chamada do cron (POST /tasks/*). */
  GODEPLOY_CRON_KEY?: string;
  // --- Observabilidade ---
  /** Nível mínimo de log: `debug` | `info` | `warn` | `error` (default `info`). */
  LOG_LEVEL?: string;
  /** `1`/`true` → log formatado para leitura humana (dev local). Default JSON. */
  LOG_PRETTY?: string;
  // --- OCR Worker: PDF → texto/OCR (F2) ---
  OCR_WORKER_URL?: string;
  OCR_WORKER_TOKEN?: string;
  /** Timeout (ms) da chamada ao OCR Worker. Default 60000. */
  OCR_WORKER_TIMEOUT_MS?: string;
  // --- IA / AI Proxy (GoGroup, gateway OpenAI-compatível) — extração + mapeamento ---
  LLM_BASE_URL?: string;
  /** Token do proxy (modo gateway). */
  API_PROXY_TOKEN?: string;
  /** Chave direta (fallback quando não há LLM_BASE_URL). */
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  /** `openai` (default) ou `anthropic`. */
  LLM_PROVIDER?: string;
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
