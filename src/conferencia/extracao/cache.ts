/**
 * Extração de ponta a ponta com **cache por hash do arquivo** (spec §5.3 item 5 / §7):
 *
 *   PDF (bytes) ──(OCR Worker, reusa F2)──▶ texto ──(AI Proxy)──▶ CamposNfBrutos
 *
 * O cache é keyed pelo SHA-256 do PDF, então um arquivo já visto **não** é re-OCR'd
 * nem re-extraído pela IA (as duas chamadas externas caras). Se o chamador já tem o
 * hash (o `ArquivoBaixado` da F4 o traz), passa em `hashConhecido` e evita rehashing.
 *
 * O cache fica atrás de uma interface: agora uma impl em memória (dev/testes); a C5
 * pode prover uma sobre `env.DB` sem tocar nesta camada.
 */
import type { CamposNfBrutos } from '../tipos.js';
import type { ExtratorCampos } from '../contratos.js';
import type { LeitorPdf } from '../../extract/ocr-worker.js';
import { sha256Hex } from './hash.js';

/** Cache de campos extraídos, indexado pelo hash (SHA-256) do arquivo. */
export interface CacheExtracao {
  obter(hash: string): Promise<CamposNfBrutos | undefined>;
  salvar(hash: string, campos: CamposNfBrutos): Promise<void>;
}

/** Impl em memória (Map). Suficiente para dev/testes e para uma instância de worker. */
export class CacheExtracaoMemoria implements CacheExtracao {
  readonly #mapa = new Map<string, CamposNfBrutos>();

  obter(hash: string): Promise<CamposNfBrutos | undefined> {
    return Promise.resolve(this.#mapa.get(hash));
  }

  salvar(hash: string, campos: CamposNfBrutos): Promise<void> {
    this.#mapa.set(hash, campos);
    return Promise.resolve();
  }
}

export interface DependenciasExtracao {
  /** OCR Worker (reusa F2 — `criarLeitorPdf`): PDF bytes → texto. */
  lerPdf: LeitorPdf;
  /** Extrator de campos via AI Proxy. */
  extrator: ExtratorCampos;
  /** Cache por hash (default: `CacheExtracaoMemoria`). */
  cache?: CacheExtracao;
}

/** Extração com cache: PDF → texto (OCR) → campos (IA), memoizado por hash do arquivo. */
export interface ExtracaoNf {
  /**
   * Extrai os campos da NF a partir dos bytes do PDF. Passe `hashConhecido` (ex.: o
   * `hash` do `ArquivoBaixado`) para evitar recalcular o SHA-256.
   */
  extrairDoPdf(bytes: Uint8Array, hashConhecido?: string): Promise<CamposNfBrutos>;
}

export function criarExtracaoNf(deps: DependenciasExtracao): ExtracaoNf {
  const cache = deps.cache ?? new CacheExtracaoMemoria();
  return {
    async extrairDoPdf(bytes: Uint8Array, hashConhecido?: string): Promise<CamposNfBrutos> {
      const hash = hashConhecido ?? (await sha256Hex(bytes));
      const cacheado = await cache.obter(hash);
      if (cacheado) return cacheado;

      const texto = await deps.lerPdf(bytes);
      const campos = await deps.extrator.extrair(texto);
      await cache.salvar(hash, campos);
      return campos;
    },
  };
}
