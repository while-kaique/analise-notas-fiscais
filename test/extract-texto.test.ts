import { describe, it, expect } from 'vitest';
import { extrairCamposDeTexto } from '../src/extract/index.js';

const DANFE = `NOTA FISCAL ELETRONICA - DANFE
CHAVE DE ACESSO
1234 5678 9012 3456 7890 1234 5678 9012 3456 7890 1234
EMITENTE: EMPRESA EXEMPLO LTDA
CNPJ: 11.222.333/0001-81
DATA DE EMISSAO 15/03/2024
DESTINATARIO
CNPJ 12.345.678/0001-95
PRODUTOS ......... 1.000,00
VALOR TOTAL DA NOTA 1.234,56
`;

describe('extrairCamposDeTexto', () => {
  it('extrai campos de uma DANFE com rótulos', () => {
    const campos = extrairCamposDeTexto(DANFE);
    expect(campos.cnpjEmitente).toBe('11222333000181');
    expect(campos.documentoDestinatario).toBe('12345678000195');
    expect(campos.dataEmissao).toBe('15/03/2024');
    expect(campos.valorTotal).toBe('1.234,56');
    expect(campos.chaveAcesso).toHaveLength(44);
  });

  it('usa o 1º CNPJ válido como emitente e o 2º como destinatário', () => {
    const t = 'CNPJ 11.222.333/0001-81 ... CNPJ 12.345.678/0001-95';
    const campos = extrairCamposDeTexto(t);
    expect(campos.cnpjEmitente).toBe('11222333000181');
    expect(campos.documentoDestinatario).toBe('12345678000195');
  });

  it('ignora CNPJ com DV inválido', () => {
    // 11.111.111/1111-11 é sequência repetida → inválido.
    const campos = extrairCamposDeTexto('CNPJ 11.111.111/1111-11');
    expect(campos.cnpjEmitente).toBeUndefined();
  });

  it('cai no maior valor quando não há rótulo de total', () => {
    const campos = extrairCamposDeTexto('item A 10,00 item B 250,90 frete 5,00');
    expect(campos.valorTotal).toBe('250,90');
  });

  it('aceita CPF como destinatário quando só há um CNPJ', () => {
    const t = 'CNPJ 11.222.333/0001-81 CPF 529.982.247-25';
    expect(extrairCamposDeTexto(t).documentoDestinatario).toBe('52998224725');
  });
});
