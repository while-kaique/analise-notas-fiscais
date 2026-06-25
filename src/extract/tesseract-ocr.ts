/**
 * `OcrProvider` concreto com **Tesseract** (`tesseract.js`), idioma `por` por
 * padrão (CLAUDE.md §2). Fica atrás da interface `OcrProvider` para ser trocável
 * por Cloud Vision / Textract sem reescrever o pipeline.
 *
 * O worker do tesseract.js é caro de criar: este provider o cria sob demanda na
 * 1ª chamada e o reaproveita. Lembre de `encerrar()` ao desligar o processo.
 */
import { createWorker, type Worker } from 'tesseract.js';
import { Buffer } from 'node:buffer';
import type { OcrProvider, ResultadoOcr } from './index.js';

const LANGS_PADRAO = 'por';

export class TesseractOcrProvider implements OcrProvider {
  #worker: Worker | undefined;
  #langsWorker: string | undefined;
  readonly #langsPadrao: string;

  constructor(langsPadrao: string = LANGS_PADRAO) {
    this.#langsPadrao = langsPadrao;
  }

  async #obterWorker(langs: string): Promise<Worker> {
    // Recria o worker se o idioma pedido mudar em relação ao carregado.
    if (this.#worker && this.#langsWorker === langs) return this.#worker;
    if (this.#worker) await this.#worker.terminate();
    this.#worker = await createWorker(langs);
    this.#langsWorker = langs;
    return this.#worker;
  }

  async reconhecer(imagem: Uint8Array, opts?: { langs?: string }): Promise<ResultadoOcr> {
    const langs = opts?.langs ?? this.#langsPadrao;
    const worker = await this.#obterWorker(langs);
    const { data } = await worker.recognize(Buffer.from(imagem));
    // tesseract.js reporta `confidence` em 0–100; normaliza para [0, 1].
    const confianca = Math.max(0, Math.min(1, (data.confidence ?? 0) / 100));
    return { texto: data.text ?? '', confianca };
  }

  /** Libera o worker. Chame ao encerrar o processo/worker da fila. */
  async encerrar(): Promise<void> {
    if (this.#worker) {
      await this.#worker.terminate();
      this.#worker = undefined;
      this.#langsWorker = undefined;
    }
  }
}

export const criarTesseractOcrProvider = (langs?: string): TesseractOcrProvider =>
  new TesseractOcrProvider(langs);
