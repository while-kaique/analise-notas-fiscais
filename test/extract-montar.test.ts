import { describe, it, expect } from 'vitest';
import { montarNotaExtraida, type CamposBrutos } from '../src/extract/index.js';

const COMPLETO: CamposBrutos = {
  cnpjEmitente: '11.222.333/0001-81',
  razaoSocialEmitente: 'EMPRESA EXEMPLO LTDA',
  documentoDestinatario: '12345678000195',
  dataEmissao: '2024-03-15T10:30:00-03:00',
  valorTotal: '1234.56',
  numero: '12345',
  serie: '1',
  chaveAcesso: 'NFe12345678901234567890123456789012345678901234',
};

describe('montarNotaExtraida', () => {
  it('normaliza tudo e dá confiança máxima para XML completo', () => {
    const r = montarNotaExtraida(COMPLETO, 'XML');
    expect(r.fonte).toBe('XML');
    expect(r.avisos).toEqual([]);
    expect(r.confianca).toBe(1);
    expect(r.nota).toMatchObject({
      cnpjEmitente: '11222333000181',
      dataEmissao: '2024-03-15',
      valorTotalCentavos: 123456,
      chaveAcesso: '12345678901234567890123456789012345678901234',
      numero: '12345',
      serie: '1',
    });
  });

  it('avisa e derruba a confiança quando falta o valor', () => {
    const { valorTotal: _omitido, ...semValor } = COMPLETO;
    const r = montarNotaExtraida(semValor, 'XML');
    expect(r.nota.valorTotalCentavos).toBe(0);
    expect(r.avisos.some((a) => /valor/i.test(a))).toBe(true);
    expect(r.confianca).toBeCloseTo(0.67, 2); // 2 de 3 campos críticos
  });

  it('avisa sobre CNPJ com DV inválido mas não lança', () => {
    const r = montarNotaExtraida({ ...COMPLETO, cnpjEmitente: '11.222.333/0001-00' }, 'XML');
    expect(r.nota.cnpjEmitente).toBe('11222333000100');
    expect(r.avisos.some((a) => /d[íi]gito verificador/i.test(a))).toBe(true);
  });

  it('usa a confiança do motor de OCR como base', () => {
    const r = montarNotaExtraida(COMPLETO, 'OCR', { confiancaFonte: 0.5 });
    expect(r.fonte).toBe('OCR');
    expect(r.confianca).toBe(0.5); // 0.5 * (3/3)
  });

  it('ignora chave de acesso com tamanho errado', () => {
    const r = montarNotaExtraida({ ...COMPLETO, chaveAcesso: '123' }, 'XML');
    expect(r.nota.chaveAcesso).toBeUndefined();
    expect(r.avisos.some((a) => /chave/i.test(a))).toBe(true);
  });
});
