/**
 * Configuração tipada lida de variáveis de ambiente (ver `.env.example`).
 * Falha cedo e com mensagem clara quando algo obrigatório falta em produção.
 */

export interface ConfigGoogleOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ConfigOcr {
  /** "tesseract" | "cloud-vision" | "textract" */
  provider: string;
  /** Idiomas do Tesseract (ex.: "por", "por+eng"). */
  langs: string;
}

export interface ConfigLimites {
  maxConcurrentDownloads: number;
  maxPdfSizeMb: number;
  httpTimeoutMs: number;
}

export interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  google: ConfigGoogleOAuth;
  ocr: ConfigOcr;
  databaseUrl: string;
  redisUrl?: string;
  limites: ConfigLimites;
}

type Env = Record<string, string | undefined>;

function lerNumero(env: Env, chave: string, padrao: number): number {
  const bruto = env[chave];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  const n = Number(bruto);
  if (!Number.isFinite(n)) {
    throw new Error(
      `Variável de ambiente ${chave}="${bruto}" não é um número válido.`,
    );
  }
  return n;
}

function lerTexto(env: Env, chave: string, padrao: string): string {
  const bruto = env[chave];
  return bruto === undefined || bruto.trim() === '' ? padrao : bruto;
}

/**
 * Monta a `Config` a partir de um objeto de ambiente (default: `process.env`).
 * Recebe `env` por parâmetro para facilitar testes (sem mexer no ambiente real).
 */
export function loadConfig(env: Env = process.env): Config {
  const nodeEnv = lerTexto(env, 'NODE_ENV', 'development');
  const ehProducao = nodeEnv === 'production';

  const google: ConfigGoogleOAuth = {
    clientId: lerTexto(env, 'GOOGLE_OAUTH_CLIENT_ID', ''),
    clientSecret: lerTexto(env, 'GOOGLE_OAUTH_CLIENT_SECRET', ''),
    redirectUri: lerTexto(
      env,
      'GOOGLE_OAUTH_REDIRECT_URI',
      'http://localhost:3000/auth/google/callback',
    ),
  };

  if (ehProducao && (!google.clientId || !google.clientSecret)) {
    throw new Error(
      'OAuth do Google não configurado: defina GOOGLE_OAUTH_CLIENT_ID e ' +
        'GOOGLE_OAUTH_CLIENT_SECRET em produção.',
    );
  }

  const redisUrl = env['REDIS_URL'];

  return {
    nodeEnv,
    port: lerNumero(env, 'PORT', 3000),
    logLevel: lerTexto(env, 'LOG_LEVEL', 'info'),
    google,
    ocr: {
      provider: lerTexto(env, 'OCR_PROVIDER', 'tesseract'),
      langs: lerTexto(env, 'OCR_LANGS', 'por'),
    },
    databaseUrl: lerTexto(env, 'DATABASE_URL', ''),
    ...(redisUrl && redisUrl.trim() !== '' ? { redisUrl } : {}),
    limites: {
      maxConcurrentDownloads: lerNumero(env, 'MAX_CONCURRENT_DOWNLOADS', 4),
      maxPdfSizeMb: lerNumero(env, 'MAX_PDF_SIZE_MB', 20),
      httpTimeoutMs: lerNumero(env, 'HTTP_TIMEOUT_MS', 30000),
    },
  };
}
