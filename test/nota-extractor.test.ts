import { describe, it, expect, vi } from 'vitest';
import { criarNotaExtractor } from '../src/extract/index.js';
import type { ArquivoBaixado } from '../src/types/index.js';
import type { OcrProvider } from '../src/extract/index.js';

const enc = new TextEncoder();

function arquivo(tipo: ArquivoBaixado['tipo'], conteudo: string): ArquivoBaixado {
  const bytes = enc.encode(conteudo);
  return { bytes, hash: 'x', tipo, tamanhoBytes: bytes.length };
}

const XML = `<NFe><infNFe><emit><CNPJ>11222333000181</CNPJ></emit>
  <ide><dhEmi>2024-03-15</dhEmi></ide><total><ICMSTot><vNF>1234.56</vNF></ICMSTot></total></infNFe></NFe>`;

const DANFE_TEXTO = `EMPRESA EXEMPLO LTDA
CNPJ 11.222.333/0001-81
DATA DE EMISSAO 15/03/2024
VALOR TOTAL DA NOTA 1.234,56`;

describe('NotaExtractorImpl (cascata)', () => {
  it('usa o XML quando o arquivo é XML — sem tocar em PDF/OCR', async () => {
    const lerTextoPdf = vi.fn();
    const rasterizar = vi.fn();
    const ex = criarNotaExtractor({ lerTextoPdf, rasterizar, ocr: ocrFalso('') });

    const r = await ex.extrair(arquivo('xml', XML));
    expect(r.fonte).toBe('XML');
    expect(r.nota.cnpjEmitente).toBe('11222333000181');
    expect(r.nota.valorTotalCentavos).toBe(123456);
    expect(lerTextoPdf).not.toHaveBeenCalled();
    expect(rasterizar).not.toHaveBeenCalled();
  });

  it('usa a camada de texto do PDF quando há texto útil — sem OCR', async () => {
    const rasterizar = vi.fn();
    const ex = criarNotaExtractor({
      lerTextoPdf: async () => DANFE_TEXTO,
      rasterizar,
      ocr: ocrFalso(''),
    });

    const r = await ex.extrair(arquivo('pdf', '%PDF-1.4 binário...'));
    expect(r.fonte).toBe('PDF_TEXTO');
    expect(r.nota.cnpjEmitente).toBe('11222333000181');
    expect(rasterizar).not.toHaveBeenCalled();
  });

  it('cai no OCR quando o PDF não tem texto (escaneado)', async () => {
    const rasterizar = vi.fn(async () => [new Uint8Array([1, 2, 3])]);
    const ex = criarNotaExtractor({
      lerTextoPdf: async () => '   ', // sem texto útil
      rasterizar,
      ocr: ocrFalso(DANFE_TEXTO, 0.8),
    });

    const r = await ex.extrair(arquivo('pdf', '%PDF-1.4 imagem...'));
    expect(rasterizar).toHaveBeenCalledOnce();
    expect(r.fonte).toBe('OCR');
    expect(r.nota.cnpjEmitente).toBe('11222333000181');
    expect(r.confianca).toBeCloseTo(0.8, 2); // confiança do motor * 3/3
  });

  it('não lança quando o OCR falha: retorna PDF_TEXTO com aviso', async () => {
    const ex = criarNotaExtractor({
      lerTextoPdf: async () => '',
      rasterizar: async () => {
        throw new Error('canvas indisponível');
      },
      ocr: ocrFalso(''),
    });

    const r = await ex.extrair(arquivo('pdf', '%PDF-1.4'));
    expect(r.fonte).toBe('PDF_TEXTO');
    expect(r.avisos.some((a) => /OCR/.test(a))).toBe(true);
  });
});

function ocrFalso(texto: string, confianca = 0.5): OcrProvider {
  return { reconhecer: async () => ({ texto, confianca }) };
}
