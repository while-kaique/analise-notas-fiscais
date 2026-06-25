/**
 * `NotaExtractor` concreto (F2): a **cascata** da fonte mais confiável para a
 * menos (CLAUDE.md §1):
 *   1. XML da NF-e   → `extrairCamposDeXml`
 *   2. PDF           → Cloudflare **OCR Worker** (texto + OCR server-side)
 *
 * A leitura do PDF é **injetável** (`lerTextoPdf`) — o orquestrador é fino e
 * testável com fakes, e o cliente HTTP do worker fica na borda (`ocr-worker.ts`).
 * `extrair` **nunca lança**: qualquer falha vira uma `NotaExtraida` de baixa
 * confiança com `avisos` (falha isolada, CLAUDE.md §3).
 */
import type { ArquivoBaixado, NotaExtraida } from '../types/index.js';
import type { NotaExtractor } from './index.js';
import { extrairCamposDeXml } from './xml.js';
import { extrairCamposDeTexto } from './texto.js';
import { montarNotaExtraida, type CamposBrutos } from './montar.js';
import { criarLeitorPdf, type LeitorPdf, type OcrWorkerConfig } from './ocr-worker.js';

/** Dependências injetáveis do extrator. */
export interface DependenciasExtractor {
  /**
   * Lê o texto de um PDF. Se omitido, é construído a partir de `ocrWorker`.
   * Útil para injetar um fake nos testes.
   */
  lerTextoPdf?: LeitorPdf;
  /** Config do Cloudflare OCR Worker (usada quando `lerTextoPdf` não é passado). */
  ocrWorker?: OcrWorkerConfig;
}

const decoder = new TextDecoder('utf-8');

const leitorNaoConfigurado: LeitorPdf = () => {
  throw new Error(
    'Extração de PDF indisponível: configure o OCR Worker ' +
      '(DependenciasExtractor.ocrWorker) ou injete lerTextoPdf.',
  );
};

/** Decide o tipo efetivo do arquivo combinando `tipo` declarado e o conteúdo. */
function detectarTipo(arquivo: ArquivoBaixado): 'xml' | 'pdf' | 'desconhecido' {
  if (arquivo.tipo === 'xml' || arquivo.tipo === 'pdf') return arquivo.tipo;
  // Sniff: %PDF- (magic do PDF) ou começo de XML.
  const inicio = decoder.decode(arquivo.bytes.subarray(0, 1024)).trimStart();
  if (inicio.startsWith('%PDF')) return 'pdf';
  if (inicio.startsWith('<?xml') || inicio.startsWith('<')) return 'xml';
  return 'desconhecido';
}

/** Acrescenta um aviso a um `NotaExtraida` sem mutar o original. */
function comAviso(resultado: NotaExtraida, aviso: string): NotaExtraida {
  return { ...resultado, avisos: [...resultado.avisos, aviso] };
}

export class NotaExtractorImpl implements NotaExtractor {
  readonly #lerTextoPdf: LeitorPdf;

  constructor(deps: DependenciasExtractor = {}) {
    this.#lerTextoPdf =
      deps.lerTextoPdf ??
      (deps.ocrWorker ? criarLeitorPdf(deps.ocrWorker) : leitorNaoConfigurado);
  }

  async extrair(arquivo: ArquivoBaixado): Promise<NotaExtraida> {
    const tipo = detectarTipo(arquivo);

    if (tipo === 'xml') return this.#deXml(arquivo);
    if (tipo === 'pdf') return this.#dePdf(arquivo);

    // Tipo desconhecido: tenta XML; se não render confiança, trata como PDF.
    const comoXml = this.#deXml(arquivo);
    if (comoXml.confianca > 0) return comoXml;
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
    let texto: string;
    try {
      texto = await this.#lerTextoPdf(arquivo.bytes);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      const vazio = montarNotaExtraida({} as CamposBrutos, 'PDF_TEXTO', { confiancaFonte: 0 });
      return comAviso(vazio, `Falha ao extrair texto do PDF: ${motivo}`);
    }

    const resultado = montarNotaExtraida(extrairCamposDeTexto(texto), 'PDF_TEXTO');
    if (texto.trim() === '') {
      return comAviso(resultado, 'OCR Worker retornou texto vazio.');
    }
    return resultado;
  }
}

export const criarNotaExtractor = (deps?: DependenciasExtractor): NotaExtractor =>
  new NotaExtractorImpl(deps);
