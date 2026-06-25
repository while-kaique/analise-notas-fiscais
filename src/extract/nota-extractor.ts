/**
 * `NotaExtractor` concreto (F2): a **cascata** da fonte mais confiável para a
 * menos (CLAUDE.md §1):
 *   1. XML da NF-e        → `extrairCamposDeXml`
 *   2. Texto do PDF       → `lerTextoPdf` (camada de texto) + heurísticas
 *   3. OCR                → rasteriza o PDF e roda o `OcrProvider`
 *
 * As dependências de I/O (texto do PDF, rasterização, motor de OCR) são
 * **injetáveis** — o orquestrador em si é fino e testável com fakes, e as libs
 * pesadas ficam nas bordas (CLAUDE.md §3/§7). `extrair` **nunca lança**: qualquer
 * falha vira uma `NotaExtraida` de baixa confiança com `avisos`.
 */
import type { ArquivoBaixado, NotaExtraida } from '../types/index.js';
import type { NotaExtractor, OcrProvider } from './index.js';
import { extrairCamposDeXml } from './xml.js';
import { extrairCamposDeTexto } from './texto.js';
import { montarNotaExtraida, type CamposBrutos } from './montar.js';
import { lerTextoPdf as lerTextoPdfPadrao } from './pdf.js';
import { rasterizarPdf as rasterizarPdfPadrao, type RasterizadorPdf } from './rasterizar.js';
import { criarTesseractOcrProvider } from './tesseract-ocr.js';

/** Dependências injetáveis do extrator. Tudo tem default de produção. */
export interface DependenciasExtractor {
  /** Lê a camada de texto do PDF. Default: `pdf-parse`. */
  lerTextoPdf?: (bytes: Uint8Array) => Promise<string>;
  /** Rasteriza o PDF em imagens para o OCR. Default: `pdfjs` + canvas. */
  rasterizar?: RasterizadorPdf;
  /** Motor de OCR. Default: Tesseract (`por`). */
  ocr?: OcrProvider;
  /** Idiomas passados ao OCR. Default `por`. */
  langsOcr?: string;
  /**
   * Mínimo de caracteres de texto "úteis" para confiar na camada de texto do PDF
   * e **não** cair no OCR. Default 20.
   */
  minCaracteresTexto?: number;
}

const MIN_CARACTERES_PADRAO = 20;
const decoder = new TextDecoder('utf-8');

/** Decide o tipo efetivo do arquivo combinando `tipo` declarado e o conteúdo. */
function detectarTipo(arquivo: ArquivoBaixado): 'xml' | 'pdf' | 'desconhecido' {
  if (arquivo.tipo === 'xml' || arquivo.tipo === 'pdf') return arquivo.tipo;
  // Sniff: %PDF- (magic do PDF) ou começo de XML.
  const inicio = decoder.decode(arquivo.bytes.subarray(0, 1024)).trimStart();
  if (inicio.startsWith('%PDF')) return 'pdf';
  if (inicio.startsWith('<?xml') || inicio.startsWith('<')) return 'xml';
  return 'desconhecido';
}

/** `true` se os campos extraídos têm algo aproveitável (evita confiar em ruído). */
function temCampoUtil(campos: CamposBrutos): boolean {
  return Boolean(campos.cnpjEmitente ?? campos.valorTotal ?? campos.chaveAcesso);
}

export class NotaExtractorImpl implements NotaExtractor {
  readonly #lerTextoPdf: (bytes: Uint8Array) => Promise<string>;
  readonly #rasterizar: RasterizadorPdf;
  readonly #ocr: OcrProvider;
  readonly #langsOcr: string | undefined;
  readonly #minCaracteres: number;

  constructor(deps: DependenciasExtractor = {}) {
    this.#lerTextoPdf = deps.lerTextoPdf ?? lerTextoPdfPadrao;
    this.#rasterizar = deps.rasterizar ?? rasterizarPdfPadrao;
    this.#ocr = deps.ocr ?? criarTesseractOcrProvider(deps.langsOcr);
    this.#langsOcr = deps.langsOcr;
    this.#minCaracteres = deps.minCaracteresTexto ?? MIN_CARACTERES_PADRAO;
  }

  async extrair(arquivo: ArquivoBaixado): Promise<NotaExtraida> {
    const tipo = detectarTipo(arquivo);

    if (tipo === 'xml') return this.#deXml(arquivo);
    if (tipo === 'pdf') return this.#dePdf(arquivo);

    // Tipo desconhecido: tenta XML, depois trata como PDF (texto/OCR).
    const comoXml = this.#deXml(arquivo);
    const xml = await comoXml;
    if (xml.confianca > 0) return xml;
    return this.#dePdf(arquivo);
  }

  #deXml(arquivo: ArquivoBaixado): NotaExtraida {
    const texto = decoder.decode(arquivo.bytes);
    const campos = extrairCamposDeXml(texto);
    if (campos === null) {
      return montarNotaExtraida({}, 'XML', { confiancaFonte: 0 });
    }
    return montarNotaExtraida(campos, 'XML');
  }

  async #dePdf(arquivo: ArquivoBaixado): Promise<NotaExtraida> {
    // 1) Camada de texto.
    const texto = await this.#lerTextoPdf(arquivo.bytes);
    const camposTexto = extrairCamposDeTexto(texto);
    if (texto.trim().length >= this.#minCaracteres && temCampoUtil(camposTexto)) {
      return montarNotaExtraida(camposTexto, 'PDF_TEXTO');
    }

    // 2) OCR (PDF escaneado / sem texto útil).
    try {
      const paginas = await this.#rasterizar(arquivo.bytes);
      if (paginas.length === 0) {
        return this.#fallbackTexto(camposTexto, 'PDF sem páginas rasterizáveis para OCR.');
      }
      const partes: string[] = [];
      let somaConfianca = 0;
      const langs = this.#langsOcr;
      for (const pagina of paginas) {
        const r = await this.#ocr.reconhecer(pagina, langs !== undefined ? { langs } : undefined);
        partes.push(r.texto);
        somaConfianca += r.confianca;
      }
      const confiancaOcr = somaConfianca / paginas.length;
      const campos = extrairCamposDeTexto(partes.join('\n'));
      return montarNotaExtraida(campos, 'OCR', { confiancaFonte: confiancaOcr });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      return this.#fallbackTexto(camposTexto, `Falha no OCR: ${motivo}`);
    }
  }

  /** Quando o OCR não rola, devolve o que a camada de texto deu, com aviso. */
  #fallbackTexto(camposTexto: CamposBrutos, aviso: string): NotaExtraida {
    const resultado = montarNotaExtraida(camposTexto, 'PDF_TEXTO');
    return { ...resultado, avisos: [...resultado.avisos, aviso] };
  }
}

export const criarNotaExtractor = (deps?: DependenciasExtractor): NotaExtractor =>
  new NotaExtractorImpl(deps);
