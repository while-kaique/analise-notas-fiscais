/**
 * Monta as `DependenciasPipeline` para o runtime Workers (GoDeploy):
 *  - `sheets`   — cliente real Workers-native (REST, injetado pelo chamador);
 *  - `fetcher`  — `FileFetcherWorkers` (só `fetch` + Web Crypto, SSRF guard);
 *  - `extractor`— `NotaExtractor` real com o **Cloudflare OCR Worker** (PDF→texto/OCR).
 *
 * (Substitui os antigos stubs `Indisponivel`: F2 e F4 já têm versões edge-compatíveis.)
 * Os segredos `OCR_WORKER_URL`/`OCR_WORKER_TOKEN` chegam por `env` (via `setAppSecret`);
 * se faltarem, `extrair` falha por linha com aviso (falha isolada, CLAUDE.md §3) — não derruba o lote.
 */
import type { DependenciasPipeline } from '../pipeline/index.js';
import type { SheetsClient } from '../sheets/index.js';
import { criarNotaExtractor } from '../extract/index.js';
import { criarFileFetcherWorkers } from '../download/index.js';
import type { Env } from './env.js';

/** Tamanho máximo de PDF a baixar (20 MB) e timeout de download (30 s). */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const TIMEOUT_DOWNLOAD_MS = 30_000;

export function montarDeps(sheets: SheetsClient, env: Env): DependenciasPipeline {
  const timeoutMs = Number(env.OCR_WORKER_TIMEOUT_MS);
  return {
    sheets,
    fetcher: criarFileFetcherWorkers({ maxBytes: MAX_PDF_BYTES, timeoutMs: TIMEOUT_DOWNLOAD_MS }),
    extractor: criarNotaExtractor({
      ocrWorker: {
        url: env.OCR_WORKER_URL ?? '',
        token: env.OCR_WORKER_TOKEN ?? '',
        ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
      },
    }),
  };
}
