import { describe, it, expect } from 'vitest';
import {
  construirMapaColunas,
  acharColuna,
  colunaParaA1,
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
