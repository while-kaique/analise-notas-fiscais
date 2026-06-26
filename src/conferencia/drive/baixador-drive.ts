/**
 * `BaixadorNf` que baixa a NF do **Google Drive** como a identidade de serviço
 * (decisão 11). Link do Drive → `GET drive/v3/files/{id}?alt=media` com o access token
 * da rpa_ia. Link **não-Drive** (PDF/XML por URL livre) cai no `fallback` (SSRF guard).
 */
import type { ArquivoBaixado } from '../../types/arquivo.js';
import type { BaixadorNf } from '../contratos.js';
import { detectarTipo } from '../../download/tipo-arquivo.js';
import type { CredencialServico } from './credencial.js';
import { ErroDrive, lerCorpoLimitado, sha256Hex, type FetchLike } from './comum.js';
import { ehLinkDrive, extrairFileIdDrive } from './link.js';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';
const MAX_BYTES_PADRAO = 20 * 1024 * 1024; // 20 MB
const TIMEOUT_PADRAO_MS = 60_000;

export interface OpcoesBaixadorDrive {
  credencial: CredencialServico;
  /** Usado quando o link não é do Drive (URL livre de PDF/XML). */
  fallback?: BaixadorNf;
  fetchImpl?: FetchLike;
  maxBytes?: number;
  timeoutMs?: number;
}

export class BaixadorDrive implements BaixadorNf {
  readonly #credencial: CredencialServico;
  readonly #fallback: BaixadorNf | undefined;
  readonly #fetch: FetchLike;
  readonly #maxBytes: number;
  readonly #timeoutMs: number;

  constructor(opts: OpcoesBaixadorDrive) {
    this.#credencial = opts.credencial;
    this.#fallback = opts.fallback;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#maxBytes = opts.maxBytes ?? MAX_BYTES_PADRAO;
    this.#timeoutMs = opts.timeoutMs ?? TIMEOUT_PADRAO_MS;
  }

  async baixar(link: string): Promise<ArquivoBaixado> {
    if (ehLinkDrive(link)) {
      const fileId = extrairFileIdDrive(link);
      if (fileId !== null) return this.#baixarDoDrive(fileId, link);
    }
    if (this.#fallback) return this.#fallback.baixar(link);
    throw new ErroDrive(
      `Link não reconhecido como Google Drive e sem fallback configurado: "${link}".`,
    );
  }

  async #baixarDoDrive(fileId: string, link: string): Promise<ArquivoBaixado> {
    const token = await this.#credencial.obterAccessToken();
    const url =
      `${DRIVE_BASE}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), this.#timeoutMs);
    try {
      const resposta = await this.#fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: controle.signal,
        redirect: 'error',
      });
      if (!resposta.ok) {
        const texto = await resposta.text().catch(() => '');
        throw new ErroDrive(
          `Drive respondeu ${resposta.status} ao baixar o arquivo ${fileId}` +
            `${texto ? `: ${texto.slice(0, 200)}` : ''}.`,
        );
      }

      const contentType = resposta.headers.get('content-type') ?? undefined;
      const bytes = await lerCorpoLimitado(resposta, this.#maxBytes, `arquivo ${fileId}`);
      const hash = await sha256Hex(bytes);
      const tipo = detectarTipo(bytes, contentType);

      return {
        bytes,
        ...(contentType !== undefined ? { contentType } : {}),
        hash,
        tipo,
        tamanhoBytes: bytes.byteLength,
      };
    } catch (causa) {
      if (causa instanceof ErroDrive) throw causa;
      if (causa instanceof Error && causa.name === 'AbortError') {
        throw new ErroDrive(
          `Timeout ao baixar do Drive "${link}" (limite de ${this.#timeoutMs} ms).`,
        );
      }
      const motivo = causa instanceof Error ? causa.message : String(causa);
      throw new ErroDrive(`Falha ao baixar do Drive "${link}": ${motivo}.`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Cria um {@link BaixadorNf} sobre o Google Drive. */
export function criarBaixadorDrive(opts: OpcoesBaixadorDrive): BaixadorNf {
  return new BaixadorDrive(opts);
}
