/**
 * Monta as dependências do **pipeline de conferência** (C5) para o runtime do Worker
 * (GoDeploy). Costura as fatias C2–C4 com a identidade de serviço da `rpa_ia`:
 *
 *  - `leitor`   — `LeitorPlanilhaRest` (Sheets REST) com token da rpa_ia (C4);
 *  - `baixador` — `BaixadorDrive` (Drive como rpa_ia) + fallback `FileFetcherWorkers`;
 *  - `extracao` — OCR Worker (F2) → AI Proxy (C3), cache por hash;
 *  - `mapeador` — `MapeadorColunasIa` sobre o AI Proxy (C2);
 *  - `cacheMapa`/`repo` — `RepositorioPerfisDb` sobre `env.DB` (C6).
 *
 * Segredos chegam por `env` (setAppSecret), nunca do código (CLAUDE.md §6).
 */
import type { Env } from './env.js';
import type { DepsPipeline } from '../conferencia/pipeline/index.js';
import { LeitorPlanilhaRest } from '../conferencia/pipeline/index.js';
import { CredencialRefreshToken, criarBaixadorDrive } from '../conferencia/drive/index.js';
import { criarFileFetcherWorkers } from '../download/file-fetcher-workers.js';
import {
  criarClienteLlm,
  criarExtratorCampos,
  criarExtracaoNf,
  criarLeitorPdf,
} from '../conferencia/extracao/index.js';
import { MapeadorColunasIa } from '../conferencia/mapeamento/index.js';
import { RepositorioPerfisDb } from '../conferencia/persistencia/repositorio-db.js';
import { instrumentarDeps } from '../obs/instrumentar-deps.js';
import { log } from '../obs/log.js';

/** Limites de download das NFs (20 MB / 60 s — PDFs de NF são pequenos). */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const TIMEOUT_DOWNLOAD_MS = 60_000;

/** Lote de cupons por frente a cada tick do cron. Default 25. */
export function loteConferencia(env: Env): number {
  const n = Number(env.CONF_BATCH_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 25;
}

export interface DepsConferencia extends DepsPipeline {
  repo: RepositorioPerfisDb;
}

/** Constrói só o repositório (criar/confirmar não precisam das credenciais do Google/IA). */
export function montarRepo(env: Env): RepositorioPerfisDb {
  return new RepositorioPerfisDb(env.DB);
}

export function montarDepsConferencia(env: Env): DepsConferencia {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
  const refreshToken = env.GOOGLE_OAUTH_REFRESH_TOKEN ?? '';
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Identidade de serviço (rpa_ia) não configurada: defina GOOGLE_OAUTH_CLIENT_ID, ' +
        'GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REFRESH_TOKEN (setAppSecret).',
    );
  }
  const credencial = new CredencialRefreshToken({ clientId, clientSecret, refreshToken });

  const leitor = new LeitorPlanilhaRest(() => credencial.obterAccessToken());

  const baixador = criarBaixadorDrive({
    credencial,
    fallback: criarFileFetcherWorkers({ maxBytes: MAX_PDF_BYTES, timeoutMs: TIMEOUT_DOWNLOAD_MS }),
  });

  const clienteLlm = criarClienteLlm({
    ...(env.LLM_BASE_URL ? { baseUrl: env.LLM_BASE_URL } : {}),
    apiKey: env.API_PROXY_TOKEN || env.LLM_API_KEY || '',
    model: env.LLM_MODEL ?? '',
    ...(env.LLM_PROVIDER === 'anthropic' ? { provider: 'anthropic' as const } : {}),
  });

  const timeoutMs = Number(env.OCR_WORKER_TIMEOUT_MS);
  const lerPdf = criarLeitorPdf({
    url: env.OCR_WORKER_URL ?? '',
    token: env.OCR_WORKER_TOKEN ?? '',
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
  });
  const extracao = criarExtracaoNf({ lerPdf, extrator: criarExtratorCampos(clienteLlm) });

  const mapeador = new MapeadorColunasIa(clienteLlm);
  const repo = new RepositorioPerfisDb(env.DB);

  return instrumentarDeps({ leitor, baixador, extracao, mapeador, cacheMapa: repo, repo }, log);
}
