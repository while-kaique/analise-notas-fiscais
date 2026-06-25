import { describe, it, expect } from 'vitest';
import { detectarTipo } from '../src/download/tipo-arquivo.js';

const bytes = (s: string): Uint8Array =>
  Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('detectarTipo', () => {
  it('detecta PDF pela assinatura %PDF-', () => {
    expect(detectarTipo(bytes('%PDF-1.7\n...'))).toBe('pdf');
  });

  it('detecta XML por declaração <?xml', () => {
    expect(detectarTipo(bytes('<?xml version="1.0"?><nfeProc/>'))).toBe('xml');
  });

  it('detecta XML por raiz típica de NF-e sem declaração', () => {
    expect(detectarTipo(bytes('<nfeProc xmlns="...">'))).toBe('xml');
    expect(detectarTipo(bytes('<NFe><infNFe/></NFe>'))).toBe('xml');
  });

  it('prioriza o conteúdo sobre um Content-Type mentiroso', () => {
    expect(detectarTipo(bytes('%PDF-1.4'), 'application/xml')).toBe('pdf');
  });

  it('usa o Content-Type quando o conteúdo não tem assinatura conhecida', () => {
    expect(detectarTipo(bytes('conteudo-binario-qualquer'), 'application/pdf')).toBe('pdf');
    expect(detectarTipo(bytes('algo'), 'text/xml; charset=utf-8')).toBe('xml');
  });

  it('retorna desconhecido quando nada bate', () => {
    expect(detectarTipo(bytes('apenas texto solto'), 'text/plain')).toBe('desconhecido');
    expect(detectarTipo(bytes('apenas texto solto'))).toBe('desconhecido');
  });
});
