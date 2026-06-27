import { describe, it, expect } from 'vitest';
import type { RegistroPlanilha } from '../src/conferencia/contratos.js';
import type { MapeamentoColunas, ResultadoConferencia } from '../src/conferencia/index.js';
import { colunasSaidaPadrao } from '../src/conferencia/index.js';
import {
  COLUNAS_BASE,
  normalizarCupom,
  indexarBase,
  montarLinhas,
  resultadoParaEscritas,
  centavosParaReaisBr,
  isoParaBr,
  statusDeRotulo,
} from '../src/conferencia/pipeline/index.js';

function reg(numeroLinha: number, valores: Record<string, string>): RegistroPlanilha {
  return { numeroLinha, valores };
}

const base = (cupom: string, valor: string, status: string, mes: string, id = ''): RegistroPlanilha =>
  reg(0, {
    [COLUNAS_BASE.cupom]: cupom,
    [COLUNAS_BASE.valor]: valor,
    [COLUNAS_BASE.status]: status,
    [COLUNAS_BASE.mesAno]: mes,
    [COLUNAS_BASE.id]: id,
  });

describe('normalizarCupom', () => {
  it('maiúsculas e remove espaços', () => {
    expect(normalizarCupom(' la ris sa ')).toBe('LARISSA');
    expect(normalizarCupom('Maria')).toBe('MARIA');
  });
});

describe('indexarBase', () => {
  const registros = [
    base('LARISSA', '100,00', '', '05/2026', '1'),
    base('LARISSA', '30,00', 'NF Paga', '04/2026', '3'),
    base('MARIA', '50,00', '', '05/2026', '2'),
    base('#LIXO', '10,00', '', '05/2026'),
    base('STEVIE', '#N/D', '', '05/2026'),
  ];
  const indice = indexarBase(registros, '05/2026');

  it('esperado só do mês alvo, em centavos', () => {
    expect(indice.esperadoPorCupom.get('LARISSA')?.valorCentavos).toBe(10000);
    expect(indice.esperadoPorCupom.get('MARIA')?.valorCentavos).toBe(5000);
  });
  it('ignora cupom com # e valor com # (no esperado)', () => {
    expect(indice.esperadoPorCupom.has('#LIXO')).toBe(false);
    expect(indice.esperadoPorCupom.has('STEVIE')).toBe(false);
  });
  it('histórico tem todos os meses do cupom (valor # → 0)', () => {
    expect(indice.historicoPorCupom.get('LARISSA')?.length).toBe(2);
    expect(indice.historicoPorCupom.get('STEVIE')?.[0]?.valorCentavos).toBe(0);
  });
});

describe('montarLinhas', () => {
  const indice = indexarBase(
    [base('LARISSA', '100,00', '', '05/2026', '1'), base('MARIA', '50,00', '', '05/2026', '2')],
    '05/2026',
  );
  const mapa: MapeamentoColunas = {
    cupom: { coluna: 'Cupom?', confianca: 1 },
    linkNf_influencer: { coluna: 'Link', confianca: 1 },
  };
  const frente = {
    papelLinkNf: 'influencer' as const,
    exclusoesCupom: ['LOURDES'],
    colunasSaida: colunasSaidaPadrao('(influ)'),
  };

  it('cruza form×base, normaliza, exclui, deduplica e respeita idempotência', () => {
    const form = [
      reg(2, { 'Cupom?': 'Larissa', Link: 'https://drive/open?id=AAA1' }),
      reg(3, { 'Cupom?': 'LARISSA', Link: 'https://drive/open?id=AAA2' }), // dup cupom → ignorado
      reg(4, { 'Cupom?': 'LOURDES', Link: 'https://drive/open?id=BBB' }), // excluído
      reg(5, { 'Cupom?': 'Maria', Link: '' }), // sem link → ignorado
      reg(6, { 'Cupom?': 'SEMBASE', Link: 'https://drive/open?id=CCC' }), // sem base → ignorado
      reg(7, { 'Cupom?': 'Maria', Link: 'https://drive/open?id=DDD', 'bot_Status (influ)': 'Aprovado' }), // já processado
    ];
    const linhas = montarLinhas(form, indice, mapa, frente, '05/2026');
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.numeroLinha).toBe(2);
    expect(linhas[0]?.linha.cupom).toBe('LARISSA');
    expect(linhas[0]?.linha.cupomOriginal).toBe('Larissa');
    expect(linhas[0]?.linha.valorEsperadoCentavos).toBe(10000);
    expect(linhas[0]?.linha.idBase).toBe('1');
  });

  it('sem cupom/link mapeado → vazio', () => {
    expect(montarLinhas([reg(2, { x: 'y' })], indice, {}, frente, '05/2026')).toEqual([]);
  });
});

describe('escrita', () => {
  it('centavosParaReaisBr e isoParaBr formatam para pt-BR', () => {
    expect(centavosParaReaisBr(123456)).toBe('1234,56');
    expect(centavosParaReaisBr(0)).toBe('0,00');
    expect(isoParaBr('2026-06-25')).toBe('25/06/2026');
    expect(isoParaBr(undefined)).toBe('');
  });
  it('statusDeRotulo reverte o rótulo pt-BR', () => {
    expect(statusDeRotulo('Aprovado')).toBe('APROVADO');
    expect(statusDeRotulo('Não Aprovado')).toBe('NAO_APROVADO');
    expect(statusDeRotulo('xpto')).toBeUndefined();
  });
  it('resultadoParaEscritas mapeia campos e limpa ausentes', () => {
    const r: ResultadoConferencia = {
      cupom: 'LARISSA',
      cupomOriginal: 'Larissa',
      status: 'APROVADO',
      cnpjTomador: '22165464000190',
      valorNfCentavos: 10000,
      valorEsperadoCentavos: 10000,
      retroativoCentavos: 0,
      valorTotalCentavos: 10000,
      dataNfIso: '2026-06-25',
      numeroNf: '42',
    };
    const cols = colunasSaidaPadrao('(influ)');
    const escritas = resultadoParaEscritas(r, cols, 7);
    const porColuna = Object.fromEntries(escritas.map((e) => [e.coluna, e.valor]));
    expect(escritas.every((e) => e.numeroLinha === 7)).toBe(true);
    expect(porColuna['bot_Status (influ)']).toBe('Aprovado');
    expect(porColuna['bot_Valor NF (influ)']).toBe('100,00');
    expect(porColuna['bot_Data NF (influ)']).toBe('25/06/2026');
    expect(porColuna['bot_Número NF (influ)']).toBe('42');

    const semCampos: ResultadoConferencia = {
      cupom: 'X',
      cupomOriginal: 'X',
      status: 'SEM_NF',
      valorEsperadoCentavos: 5000,
      retroativoCentavos: 0,
      valorTotalCentavos: 5000,
    };
    const e2 = Object.fromEntries(resultadoParaEscritas(semCampos, cols, 3).map((e) => [e.coluna, e.valor]));
    expect(e2['bot_Status (influ)']).toBe('Sem NF anexada');
    expect(e2['bot_CNPJ Tomador (influ)']).toBe('');
    expect(e2['bot_Data NF (influ)']).toBe('');
  });
});
