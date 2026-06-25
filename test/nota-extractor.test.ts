import { describe, it, expect, vi } from 'vitest';
import { criarNotaExtractor } from '../src/extract/index.js';
import type { ArquivoBaixado } from '../src/types/index.js';

const enc = new TextEncoder();

function arquivo(tipo: ArquivoBaixado['tipo'], conteudo: string): ArquivoBaixado {
  const bytes = enc.encode(conteudo);
  return { bytes, hash: 'x', tipo, tamanhoBytes: bytes.length };
}

const XML = `<NFe><infNFe><emit><CNPJ>11222333000181</CNPJ></emit>
  <ide><dhEmi>2024-03-15</dhEmi></ide><total><ICMSTot><vNF>1234.56</vNF></ICMSTot></infNFe></NFe>`;

const DANFE_TEXTO = `EMPRESA EXEMPLO LTDA
CNPJ 11.222.333/0001-81
DATA DE EMISSAO 15/03/2024
VALOR TOTAL DA NOTA 1.234,56`;

describe('NotaExtractorImpl (cascata XML → OCR Worker)', () => {
  it('usa o XML quando o arquivo é XML — sem chamar o worker', async () => {
    const lerTextoPdf = vi.fn();
    const ex = criarNotaExtractor({ lerTextoPdf });

    const r = await ex.extrair(arquivo('xml', XML));
    expect(r.fonte).toBe('XML');
    expect(r.nota.cnpjEmitente).toBe('11222333000181');
    expect(r.nota.valorTotalCentavos).toBe(123456);
    expect(lerTextoPdf).not.toHaveBeenCalled();
  });

  it('usa o OCR Worker para PDF e parseia o texto retornado', async () => {
    const lerTextoPdf = vi.fn(async () => DANFE_TEXTO);
    const ex = criarNotaExtractor({ lerTextoPdf });

    const r = await ex.extrair(arquivo('pdf', '%PDF-1.4 binário...'));
    expect(lerTextoPdf).toHaveBeenCalledOnce();
    expect(r.fonte).toBe('PDF_TEXTO');
    expect(r.nota.cnpjEmitente).toBe('11222333000181');
    expect(r.nota.valorTotalCentavos).toBe(123456);
    expect(r.avisos).toEqual([]);
  });

  it('não lança quando o worker falha: nota de baixa confiança com aviso', async () => {
    const ex = criarNotaExtractor({
      lerTextoPdf: async () => {
        throw new Error('502 Bad Gateway');
      },
    });

    const r = await ex.extrair(arquivo('pdf', '%PDF-1.4'));
    expect(r.fonte).toBe('PDF_TEXTO');
    expect(r.confianca).toBe(0);
    expect(r.avisos.some((a) => /502 Bad Gateway/.test(a))).toBe(true);
  });

  it('avisa quando o worker devolve texto vazio', async () => {
    const ex = criarNotaExtractor({ lerTextoPdf: async () => '   ' });
    const r = await ex.extrair(arquivo('pdf', '%PDF-1.4'));
    expect(r.avisos.some((a) => /vazio/i.test(a))).toBe(true);
  });

  it('sem worker configurado nem lerTextoPdf, falha isolada com aviso', async () => {
    const ex = criarNotaExtractor();
    const r = await ex.extrair(arquivo('pdf', '%PDF-1.4'));
    expect(r.confianca).toBe(0);
    expect(r.avisos.some((a) => /OCR Worker|indispon/i.test(a))).toBe(true);
  });
});
