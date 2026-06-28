import { describe, it, expect } from 'vitest';
import {
  construirMapaColunas,
  acharColuna,
  colunaParaA1,
  desambiguarCabecalhos,
} from '../src/sheets/colunas.js';

describe('construirMapaColunas', () => {
  it('mapeia cabeçalho → índice 0-based', () => {
    const mapa = construirMapaColunas(['Link', 'Status', 'Valor']);
    expect(mapa).toEqual({ Link: 0, Status: 1, Valor: 2 });
  });

  it('faz trim e ignora células de cabeçalho vazias', () => {
    const mapa = construirMapaColunas(['  Link  ', '', 'Status']);
    expect(mapa).toEqual({ Link: 0, Status: 2 });
  });

  it('mantém a primeira ocorrência em caso de cabeçalho repetido', () => {
    const mapa = construirMapaColunas(['Status', 'Status']);
    expect(mapa['Status']).toBe(0);
  });
});

describe('desambiguarCabecalhos', () => {
  it('mantém nomes únicos e vazios intactos', () => {
    expect(desambiguarCabecalhos(['Cupom', '', 'Link'])).toEqual(['Cupom', '', 'Link']);
  });

  it('sufixa a 2ª+ ocorrência (form influ + assessoria)', () => {
    expect(
      desambiguarCabecalhos(['Qual o nome?', 'Cupom', 'Qual o nome?', 'Qual o nome?']),
    ).toEqual(['Qual o nome?', 'Cupom', 'Qual o nome? (2)', 'Qual o nome? (3)']);
  });

  it('é case-insensitive e faz trim ao detectar duplicata', () => {
    expect(desambiguarCabecalhos(['  Nome ', 'nome'])).toEqual(['Nome', 'nome (2)']);
  });

  it('não colide com um " (2)" que já exista no formulário', () => {
    expect(desambiguarCabecalhos(['Nome', 'Nome (2)', 'Nome'])).toEqual([
      'Nome',
      'Nome (2)',
      'Nome (3)',
    ]);
  });
});

describe('acharColuna', () => {
  it('acha coluna de forma case-insensitive', () => {
    const mapa = construirMapaColunas(['status', 'CNPJ Emitente']);
    expect(acharColuna(mapa, 'Status')).toBe(0);
    expect(acharColuna(mapa, 'cnpj emitente')).toBe(1);
    expect(acharColuna(mapa, 'Inexistente')).toBeNull();
  });
});

describe('colunaParaA1', () => {
  it('converte índices para notação A1', () => {
    expect(colunaParaA1(0)).toBe('A');
    expect(colunaParaA1(25)).toBe('Z');
    expect(colunaParaA1(26)).toBe('AA');
    expect(colunaParaA1(27)).toBe('AB');
    expect(colunaParaA1(701)).toBe('ZZ');
    expect(colunaParaA1(702)).toBe('AAA');
  });

  it('rejeita índice inválido', () => {
    expect(() => colunaParaA1(-1)).toThrow();
    expect(() => colunaParaA1(1.5)).toThrow();
  });
});
