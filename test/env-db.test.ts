import { describe, it, expect } from 'vitest';
import {
  linhasComoObjetos,
  primeiraLinha,
  comoTexto,
  comoInteiro,
  type ResultadoQuery,
} from '../src/api/env.js';

describe('linhasComoObjetos', () => {
  it('faz zip de linhas em array com columns', () => {
    const res: ResultadoQuery = {
      columns: ['id', 'nome'],
      rows: [
        ['1', 'a'],
        ['2', 'b'],
      ],
      rowsRead: 2,
    };
    expect(linhasComoObjetos(res)).toEqual([
      { id: '1', nome: 'a' },
      { id: '2', nome: 'b' },
    ]);
  });

  it('passa adiante linhas que já são objetos', () => {
    const res: ResultadoQuery = {
      columns: ['id'],
      rows: [{ id: 9 }],
      rowsRead: 1,
    };
    expect(linhasComoObjetos(res)).toEqual([{ id: 9 }]);
  });

  it('primeiraLinha devolve undefined quando vazio', () => {
    expect(primeiraLinha({ columns: [], rows: [], rowsRead: 0 })).toBeUndefined();
  });
});

describe('coerções', () => {
  it('comoTexto trata null/undefined como vazio', () => {
    expect(comoTexto(null)).toBe('');
    expect(comoTexto(undefined)).toBe('');
    expect(comoTexto(42)).toBe('42');
  });

  it('comoInteiro trunca e protege contra inválidos', () => {
    expect(comoInteiro('12')).toBe(12);
    expect(comoInteiro(3.9)).toBe(3);
    expect(comoInteiro('abc')).toBe(0);
    expect(comoInteiro(null)).toBe(0);
  });
});
