import { describe, it, expect } from 'vitest';
import type { LinhaResultado } from '../src/types/index.js';
import {
  construirMapaColunas,
  acharColuna,
  acharColunaLink,
  colunaParaA1,
  centavosParaReais,
  resultadoParaCelulas,
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

describe('acharColuna / acharColunaLink', () => {
  it('acha coluna de forma case-insensitive', () => {
    const mapa = construirMapaColunas(['status', 'CNPJ Emitente']);
    expect(acharColuna(mapa, 'Status')).toBe(0);
    expect(acharColuna(mapa, 'cnpj emitente')).toBe(1);
    expect(acharColuna(mapa, 'Inexistente')).toBeNull();
  });

  it('acha a coluna de link entre os candidatos', () => {
    expect(acharColunaLink(construirMapaColunas(['Link', 'Status']))).toBe(0);
    expect(acharColunaLink(construirMapaColunas(['Status', 'URL']))).toBe(1);
    expect(acharColunaLink(construirMapaColunas(['Status', 'Valor']))).toBeNull();
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

describe('centavosParaReais', () => {
  it('converte centavos inteiros para reais', () => {
    expect(centavosParaReais(123456)).toBe(1234.56);
    expect(centavosParaReais(100)).toBe(1);
    expect(centavosParaReais(0)).toBe(0);
  });
});

describe('resultadoParaCelulas', () => {
  const mapa = construirMapaColunas([
    'Link',
    'Status',
    'CNPJ Emitente',
    'Data Emissão',
    'Valor',
    'Erro',
    'Processado em',
  ]);

  it('mapeia um resultado CONCLUIDO para as células de resultado (com aba)', () => {
    const resultado: LinhaResultado = {
      numeroLinha: 5,
      status: 'CONCLUIDO',
      nota: {
        cnpjEmitente: '12345678000199',
        dataEmissao: '2026-01-15',
        valorTotalCentavos: 123456,
      },
      fonte: 'XML',
      confianca: 0.9,
      processadoEm: '2026-06-25T12:00:00.000Z',
    };
    const celulas = resultadoParaCelulas(resultado, mapa, 'Página1');
    const porRange = Object.fromEntries(celulas.map((c) => [c.range, c.valor]));

    expect(porRange["'Página1'!B5"]).toBe('CONCLUIDO');
    expect(porRange["'Página1'!C5"]).toBe('12345678000199');
    expect(porRange["'Página1'!D5"]).toBe('2026-01-15');
    expect(porRange["'Página1'!E5"]).toBe(1234.56);
    expect(porRange["'Página1'!F5"]).toBe(''); // erro vazio
    expect(porRange["'Página1'!G5"]).toBe('2026-06-25T12:00:00.000Z');
    // Nunca escreve na coluna de link (A) — dado do usuário.
    expect(porRange["'Página1'!A5"]).toBeUndefined();
  });

  it('limpa os campos de dados num resultado de ERRO', () => {
    const resultado: LinhaResultado = {
      numeroLinha: 3,
      status: 'ERRO',
      erro: 'link morto (404)',
      processadoEm: '2026-06-25T12:00:00.000Z',
    };
    const celulas = resultadoParaCelulas(resultado, mapa);
    const porRange = Object.fromEntries(celulas.map((c) => [c.range, c.valor]));

    expect(porRange['B3']).toBe('ERRO');
    expect(porRange['C3']).toBe('');
    expect(porRange['E3']).toBe(''); // valor limpo
    expect(porRange['F3']).toBe('link morto (404)');
  });

  it('só escreve nas colunas de resultado existentes', () => {
    const mapaParcial = construirMapaColunas(['Link', 'Status']);
    const resultado: LinhaResultado = {
      numeroLinha: 2,
      status: 'PROCESSANDO',
      processadoEm: '2026-06-25T12:00:00.000Z',
    };
    const celulas = resultadoParaCelulas(resultado, mapaParcial);
    // Só 'Status' existe entre as colunas de resultado.
    expect(celulas).toHaveLength(1);
    expect(celulas[0]).toEqual({ range: 'B2', valor: 'PROCESSANDO' });
  });
});
