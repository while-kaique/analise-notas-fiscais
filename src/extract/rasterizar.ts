/**
 * Borda de I/O: **rasteriza** as páginas de um PDF em imagens PNG, para alimentar
 * o OCR de PDFs escaneados (CLAUDE.md §5 — aumentar DPI ajuda o reconhecimento).
 *
 * Usa `pdfjs-dist` (render) + `@napi-rs/canvas` (canvas com binários pré-compilados,
 * instala no Windows sem toolchain nativa). É carregado **sob demanda** (import
 * dinâmico) para não pesar o startup de quem só processa XML/PDF-texto. Tipagem
 * via casts locais — libs sem tipos estáveis para uso server-side.
 */

/** Converte um PDF (bytes) em uma imagem PNG (bytes) por página. */
export type RasterizadorPdf = (bytes: Uint8Array, opts?: OpcoesRaster) => Promise<Uint8Array[]>;

export interface OpcoesRaster {
  /** Fator de escala (≈ DPI/72). Padrão 2.0 (~144 DPI) — bom equilíbrio p/ OCR. */
  escala?: number;
  /** Limite de páginas a rasterizar (evita estourar memória em PDFs enormes). */
  maxPaginas?: number;
}

const ESCALA_PADRAO = 2.0;
const MAX_PAGINAS_PADRAO = 20;

// Cache do módulo pdfjs (carregar é caro; reusa entre chamadas).
let pdfjsPromise: Promise<unknown> | undefined;
const carregarPdfjs = (): Promise<unknown> => {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
};

export const rasterizarPdf: RasterizadorPdf = async (bytes, opts = {}) => {
  const escala = opts.escala ?? ESCALA_PADRAO;
  const maxPaginas = opts.maxPaginas ?? MAX_PAGINAS_PADRAO;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const pdfjs = (await carregarPdfjs()) as any;
  const { createCanvas } = (await import('@napi-rs/canvas')) as any;

  // `data` precisa ser um Uint8Array "puro" (não Buffer compartilhado) p/ o pdfjs.
  const data = new Uint8Array(bytes);
  const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;

  const total = Math.min(doc.numPages as number, maxPaginas);
  const paginas: Uint8Array[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: escala });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      paginas.push(new Uint8Array(canvas.toBuffer('image/png')));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return paginas;
};
