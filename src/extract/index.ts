import type { ArquivoBaixado, NotaExtraida } from '../types/index.js';

/**
 * Extrai os campos da nota a partir do arquivo baixado.
 * Implementação: fatia F2.
 *
 * Cascata de fontes, da mais confiável para a menos (CLAUDE.md §1):
 *   1. XML da NF-e   → parsing estruturado
 *   2. Texto do PDF  → `pdf-parse` (PDF com camada de texto)
 *   3. OCR           → `OcrProvider` (último recurso, PDF escaneado)
 *
 * A `fonte` do `NotaExtraida` indica qual caminho foi usado.
 */
export interface NotaExtractor {
  extrair(arquivo: ArquivoBaixado): Promise<NotaExtraida>;
}

/** Texto bruto reconhecido por um motor de OCR. */
export interface ResultadoOcr {
  texto: string;
  /** Confiança média reportada pelo motor, em [0, 1]. */
  confianca: number;
}

/**
 * Motor de OCR, atrás de interface para trocar Tesseract → Cloud Vision /
 * Textract sem reescrever o pipeline (CLAUDE.md §2).
 *
 * Pré-processamento da imagem (deskew, binarização, DPI) é responsabilidade
 * da implementação antes de chamar o motor (CLAUDE.md §5).
 */
export interface OcrProvider {
  /** Recebe uma imagem (ou página rasterizada) e devolve o texto. */
  reconhecer(imagem: Uint8Array, opts?: { langs?: string }): Promise<ResultadoOcr>;
}

// ───────────────────────────── Implementação (F2) ────────────────────────────

export { NotaExtractorImpl, criarNotaExtractor } from './nota-extractor.js';
export type { DependenciasExtractor } from './nota-extractor.js';
export { TesseractOcrProvider, criarTesseractOcrProvider } from './tesseract-ocr.js';
export { extrairCamposDeXml } from './xml.js';
export { extrairCamposDeTexto } from './texto.js';
export { montarNotaExtraida, PESO_FONTE } from './montar.js';
export type { CamposBrutos } from './montar.js';
export { lerTextoPdf } from './pdf.js';
export { rasterizarPdf } from './rasterizar.js';
export type { RasterizadorPdf, OpcoesRaster } from './rasterizar.js';
