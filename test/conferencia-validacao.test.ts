import { describe, it, expect } from 'vitest';
import {
  classificarStatus,
  statusEhMelhor,
  ORDEM_APROVACAO,
  mesParaNumero,
  validarNfInicial,
  valorNfParaCentavos,
  validarComRetroativo,
  reconciliarSoma,
} from '../src/conferencia/validacao/index.js';
import {
  MARCA_GOCASE,
  MARGEM_PARCIAL_CENTAVOS,
  STATUS_BLOQUEANTES_PADRAO,
  ROTULO_STATUS,
} from '../src/conferencia/index.js';
import type { CamposNfBrutos, EntradaHistorico, LinhaConferencia } from '../src/conferencia/tipos.js';

const GOCASE = MARCA_GOCASE.cnpjTomador; // '22165464000190'
const MARGEM = MARGEM_PARCIAL_CENTAVOS; // 3000 = R$ 30,00

/** Monta uma LinhaConferencia com defaults sensatos para os testes. */
function linha(over: Partial<LinhaConferencia> = {}): LinhaConferencia {
  return {
    cupom: 'CUPOM1',
    cupomOriginal: 'cupom1',
    linkNf: 'https://drive.google.com/file/d/abc',
    valorEsperadoCentavos: 10000,
    mesAno: '03/2026',
    ...over,
  };
}

/** Campos crus da IA com CNPJ do tomador = Gocase por padrão. */
function campos(over: Partial<CamposNfBrutos> = {}): CamposNfBrutos {
  return {
    CNPJ1: '11222333000181', // emissor (qualquer)
    CNPJ2: GOCASE, // tomador = marca
    Valor: 100.0,
    data_emissao: '25/06/2026',
    num_nota: '123',
    ...over,
  };
}

describe('classificarStatus', () => {
  it('diferença exata → APROVADO', () => {
    expect(classificarStatus(0, MARGEM)).toBe('APROVADO');
  });

  it('diferença dentro da margem (inclusive) → PARCIAL', () => {
    expect(classificarStatus(1, MARGEM)).toBe('PARCIAL');
    expect(classificarStatus(3000, MARGEM)).toBe('PARCIAL');
    expect(classificarStatus(-2999, MARGEM)).toBe('PARCIAL'); // usa o módulo
  });

  it('diferença acima da margem → NAO_APROVADO', () => {
    expect(classificarStatus(3001, MARGEM)).toBe('NAO_APROVADO');
    expect(classificarStatus(-5000, MARGEM)).toBe('NAO_APROVADO');
  });

  it('margem 0 só aprova exato', () => {
    expect(classificarStatus(0, 0)).toBe('APROVADO');
    expect(classificarStatus(1, 0)).toBe('NAO_APROVADO');
  });
});

describe('statusEhMelhor', () => {
  it('aprovado supera todos; igual não melhora', () => {
    expect(statusEhMelhor('APROVADO', 'PARCIAL')).toBe(true);
    expect(statusEhMelhor('PARCIAL', 'NAO_APROVADO')).toBe(true);
    expect(statusEhMelhor('NAO_APROVADO', 'SEM_NF')).toBe(true);
    expect(statusEhMelhor('PARCIAL', 'PARCIAL')).toBe(false);
    expect(statusEhMelhor('NAO_APROVADO', 'APROVADO')).toBe(false);
  });

  it('ranking cobre todos os status', () => {
    // Deriva do vocabulário de status para não quebrar ao adicionar um novo.
    expect(Object.keys(ORDEM_APROVACAO).sort()).toEqual(Object.keys(ROTULO_STATUS).sort());
  });
});

describe('mesParaNumero', () => {
  it('converte MM/YYYY para ano*12+mes', () => {
    expect(mesParaNumero('06/2026')).toBe(2026 * 12 + 6);
    expect(mesParaNumero('12/2025')).toBe(2025 * 12 + 12);
  });

  it('janeiro de um ano é maior que dezembro do anterior', () => {
    expect(mesParaNumero('01/2026')! > mesParaNumero('12/2025')!).toBe(true);
  });

  it('aceita 1 dígito no mês e espaços ao redor', () => {
    expect(mesParaNumero(' 6/2026 ')).toBe(2026 * 12 + 6);
  });

  it('rejeita formatos inválidos', () => {
    expect(mesParaNumero('2026')).toBeNull();
    expect(mesParaNumero('13/2026')).toBeNull();
    expect(mesParaNumero('00/2026')).toBeNull();
    expect(mesParaNumero('ab/2026')).toBeNull();
    expect(mesParaNumero('')).toBeNull();
    expect(mesParaNumero('06/2026/01')).toBeNull();
  });
});

describe('valorNfParaCentavos', () => {
  it('número float vira centavos arredondados', () => {
    expect(valorNfParaCentavos(100)).toBe(10000);
    expect(valorNfParaCentavos(100.0)).toBe(10000);
    expect(valorNfParaCentavos(1234.56)).toBe(123456);
    expect(valorNfParaCentavos(0.1)).toBe(10);
  });

  it('texto passa pelo parser robusto da F1', () => {
    expect(valorNfParaCentavos('R$ 1.234,56')).toBe(123456);
    expect(valorNfParaCentavos('100,00')).toBe(10000);
  });

  it('retorna null para entrada inválida', () => {
    expect(valorNfParaCentavos(undefined)).toBeNull();
    expect(valorNfParaCentavos('abc')).toBeNull();
    expect(valorNfParaCentavos(Number.NaN)).toBeNull();
  });
});

describe('validarNfInicial', () => {
  it('sem link → SEM_NF (terminal)', () => {
    const r = validarNfInicial(linha({ linkNf: '' }), null, MARCA_GOCASE);
    expect(r.resultado.status).toBe('SEM_NF');
    expect(r.precisaRetroativo).toBe(false);
    expect(r.resultado.valorEsperadoCentavos).toBe(10000);
    expect(r.resultado.retroativoCentavos).toBe(0);
    expect(r.resultado.valorTotalCentavos).toBe(10000);
    expect(r.resultado.valorNfCentavos).toBeUndefined();
  });

  it('link em branco (só espaços) também → SEM_NF', () => {
    const r = validarNfInicial(linha({ linkNf: '   ' }), campos(), MARCA_GOCASE);
    expect(r.resultado.status).toBe('SEM_NF');
  });

  it('IA não leu (campos null / faltando CNPJ ou Valor) → NAO_LEGIVEL', () => {
    expect(validarNfInicial(linha(), null, MARCA_GOCASE).resultado.status).toBe('NAO_LEGIVEL');
    expect(validarNfInicial(linha(), campos({ CNPJ1: '' }), MARCA_GOCASE).resultado.status).toBe('NAO_LEGIVEL');
    expect(validarNfInicial(linha(), campos({ CNPJ2: undefined }), MARCA_GOCASE).resultado.status).toBe('NAO_LEGIVEL');
    expect(validarNfInicial(linha(), campos({ Valor: undefined }), MARCA_GOCASE).resultado.status).toBe('NAO_LEGIVEL');
  });

  it('valor presente mas ilegível → NAO_LEGIVEL', () => {
    const r = validarNfInicial(linha(), campos({ Valor: 'abc' }), MARCA_GOCASE);
    expect(r.resultado.status).toBe('NAO_LEGIVEL');
  });

  it('nenhum CNPJ casa com a marca → CNPJ_DIFERENTE, guardando valor/num/data', () => {
    const r = validarNfInicial(
      linha(),
      campos({ CNPJ1: '11222333000181', CNPJ2: '99888777000166', Valor: 250.0 }),
      MARCA_GOCASE,
    );
    expect(r.resultado.status).toBe('CNPJ_DIFERENTE');
    expect(r.precisaRetroativo).toBe(false);
    expect(r.resultado.valorNfCentavos).toBe(25000); // valor preservado
    expect(r.resultado.numeroNf).toBe('123');
    expect(r.resultado.dataNfIso).toBe('2026-06-25');
    expect(r.resultado.cnpjTomador).toBeUndefined();
  });

  it('valor exato + CNPJ casa (no CNPJ2) → APROVADO, terminal', () => {
    const r = validarNfInicial(linha(), campos({ Valor: 100.0 }), MARCA_GOCASE);
    expect(r.resultado.status).toBe('APROVADO');
    expect(r.precisaRetroativo).toBe(false);
    expect(r.resultado.cnpjTomador).toBe(GOCASE);
    expect(r.resultado.valorNfCentavos).toBe(10000);
    expect(r.resultado.numeroNf).toBe('123');
    expect(r.resultado.dataNfIso).toBe('2026-06-25');
  });

  it('CNPJ da marca pode vir no CNPJ1 (emissor) — casa do mesmo jeito', () => {
    const r = validarNfInicial(linha(), campos({ CNPJ1: GOCASE, CNPJ2: '11222333000181' }), MARCA_GOCASE);
    expect(r.resultado.status).toBe('APROVADO');
    expect(r.resultado.cnpjTomador).toBe(GOCASE);
  });

  it('dentro da margem mas não exato → PARCIAL e pede retroativo', () => {
    const r = validarNfInicial(linha({ valorEsperadoCentavos: 10000 }), campos({ Valor: 100.3 }), MARCA_GOCASE);
    expect(r.resultado.status).toBe('PARCIAL');
    expect(r.precisaRetroativo).toBe(true);
    expect(r.resultado.valorNfCentavos).toBe(10030);
  });

  it('acima da margem → NAO_APROVADO e pede retroativo', () => {
    const r = validarNfInicial(linha({ valorEsperadoCentavos: 10000 }), campos({ Valor: 250.0 }), MARCA_GOCASE);
    expect(r.resultado.status).toBe('NAO_APROVADO');
    expect(r.precisaRetroativo).toBe(true);
  });

  it('aceita Valor como string com formatação brasileira', () => {
    const r = validarNfInicial(linha({ valorEsperadoCentavos: 123456 }), campos({ Valor: 'R$ 1.234,56' }), MARCA_GOCASE);
    expect(r.resultado.status).toBe('APROVADO');
    expect(r.resultado.valorNfCentavos).toBe(123456);
  });

  it('data inválida não derruba; só não grava dataNfIso', () => {
    const r = validarNfInicial(linha(), campos({ data_emissao: '99/99/9999', num_nota: '' }), MARCA_GOCASE);
    expect(r.resultado.status).toBe('APROVADO');
    expect(r.resultado.dataNfIso).toBeUndefined();
    expect(r.resultado.numeroNf).toBeUndefined();
  });
});

describe('validarComRetroativo', () => {
  const baseEntrada = {
    mesAno: '03/2026',
    statusBloqueantes: STATUS_BLOQUEANTES_PADRAO,
    margemParcialCentavos: MARGEM,
  };

  it('uma NF cobre o mês anterior → APROVADO somando o retroativo', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 25000,
      valorBaseCentavos: 10000,
      historico: [{ mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' }],
    });
    expect(r.status).toBe('APROVADO');
    expect(r.retroativoCentavos).toBe(15000);
    expect(r.valorEsperadoCentavos).toBe(25000);
    expect(r.valorTotalCentavos).toBe(25000);
    expect(r.mesesRetroativos).toEqual(['02/2026']);
  });

  it('acumula vários meses, do mais recente ao mais antigo', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 40000,
      valorBaseCentavos: 10000,
      historico: [
        { mesAno: '01/2026', valorCentavos: 15000, status: 'Pendente' },
        { mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' },
      ],
    });
    expect(r.status).toBe('APROVADO');
    expect(r.retroativoCentavos).toBe(30000);
    expect(r.mesesRetroativos).toEqual(['02/2026', '01/2026']);
  });

  it('status bloqueante para a acumulação sem somar o mês bloqueado', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 25000,
      valorBaseCentavos: 10000,
      historico: [
        { mesAno: '02/2026', valorCentavos: 15000, status: 'NF Paga' }, // bloqueante e mais recente
        { mesAno: '01/2026', valorCentavos: 15000, status: 'Pendente' },
      ],
    });
    expect(r.status).toBe('NAO_APROVADO');
    expect(r.retroativoCentavos).toBe(0);
    expect(r.mesesRetroativos).toEqual([]);
    expect(r.valorEsperadoCentavos).toBe(10000); // fica só a base
  });

  it('chega perto → PARCIAL (generalização do n8n binário)', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 24000,
      valorBaseCentavos: 10000,
      historico: [{ mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' }],
    });
    expect(r.status).toBe('PARCIAL'); // |25000-24000| = 1000 ≤ 3000
    expect(r.retroativoCentavos).toBe(15000);
  });

  it('não piora: se somar afasta, mantém o melhor ponto (base como fallback)', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 8000, // menor que a base; somar só afasta
      valorBaseCentavos: 10000,
      historico: [{ mesAno: '02/2026', valorCentavos: 5000, status: 'Pendente' }],
    });
    expect(r.status).toBe('PARCIAL'); // |10000-8000| = 2000 ≤ 3000
    expect(r.retroativoCentavos).toBe(0);
    expect(r.mesesRetroativos).toEqual([]);
  });

  it('para no melhor ponto e não acumula meses inúteis depois', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 24000,
      valorBaseCentavos: 10000,
      historico: [
        { mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' }, // → 25000, diff 1000 (melhor)
        { mesAno: '01/2026', valorCentavos: 15000, status: 'Pendente' }, // → 40000, diff 16000 (pior)
      ],
    });
    expect(r.status).toBe('PARCIAL');
    expect(r.retroativoCentavos).toBe(15000);
    expect(r.mesesRetroativos).toEqual(['02/2026']);
  });

  it('ignora mês atual e futuros; só considera anteriores', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 25000,
      valorBaseCentavos: 10000,
      historico: [
        { mesAno: '03/2026', valorCentavos: 99999, status: 'Pendente' }, // mês alvo: ignorado
        { mesAno: '04/2026', valorCentavos: 99999, status: 'Pendente' }, // futuro: ignorado
        { mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' },
      ],
    });
    expect(r.status).toBe('APROVADO');
    expect(r.mesesRetroativos).toEqual(['02/2026']);
  });

  it('remove duplicatas (mesmo Mês/Ano + valor)', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 40000,
      valorBaseCentavos: 10000,
      historico: [
        { mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' },
        { mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' }, // duplicata exata
        { mesAno: '01/2026', valorCentavos: 15000, status: 'Pendente' },
      ],
    });
    expect(r.status).toBe('APROVADO');
    expect(r.retroativoCentavos).toBe(30000);
    expect(r.mesesRetroativos).toEqual(['02/2026', '01/2026']); // não ['02/2026','02/2026']
  });

  it('histórico vazio → cai na classificação da base', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 25000,
      valorBaseCentavos: 10000,
      historico: [],
    });
    expect(r.status).toBe('NAO_APROVADO');
    expect(r.retroativoCentavos).toBe(0);
  });

  it('entradas com Mês/Ano inválido são ignoradas', () => {
    const r = validarComRetroativo({
      ...baseEntrada,
      valorNfCentavos: 25000,
      valorBaseCentavos: 10000,
      historico: [
        { mesAno: 'lixo', valorCentavos: 15000, status: 'Pendente' },
        { mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' },
      ],
    });
    expect(r.status).toBe('APROVADO');
    expect(r.mesesRetroativos).toEqual(['02/2026']);
  });
});

describe('reconciliarSoma', () => {
  it('influ + assessoria batem com a base → APROVADO', () => {
    const r = reconciliarSoma({
      cupom: 'CUPOM1',
      valorNfInfluCentavos: 6000,
      valorNfAssessoriaCentavos: 4000,
      valorBaseCentavos: 10000,
      margemParcialCentavos: MARGEM,
    });
    expect(r.status).toBe('APROVADO');
    expect(r.somaCentavos).toBe(10000);
    expect(r.valorEsperadoCentavos).toBe(10000);
    expect(r.cupom).toBe('CUPOM1');
  });

  it('soma dentro da margem → PARCIAL', () => {
    const r = reconciliarSoma({
      cupom: 'C',
      valorNfInfluCentavos: 6000,
      valorNfAssessoriaCentavos: 4000,
      valorBaseCentavos: 10500,
      margemParcialCentavos: MARGEM,
    });
    expect(r.status).toBe('PARCIAL'); // diff 500
  });

  it('soma longe da base → NAO_APROVADO', () => {
    const r = reconciliarSoma({
      cupom: 'C',
      valorNfInfluCentavos: 6000,
      valorNfAssessoriaCentavos: 4000,
      valorBaseCentavos: 20000,
      margemParcialCentavos: MARGEM,
    });
    expect(r.status).toBe('NAO_APROVADO'); // diff 10000
  });
});

describe('composição inicial + retroativo (como o C5 vai orquestrar)', () => {
  it('NAO_APROVADO inicial vira APROVADO após retroativo', () => {
    const l = linha({ valorEsperadoCentavos: 10000 });
    const ini = validarNfInicial(l, campos({ Valor: 250.0 }), MARCA_GOCASE);
    expect(ini.resultado.status).toBe('NAO_APROVADO');
    expect(ini.precisaRetroativo).toBe(true);

    const retro = validarComRetroativo({
      valorNfCentavos: ini.resultado.valorNfCentavos!,
      valorBaseCentavos: l.valorEsperadoCentavos,
      mesAno: l.mesAno,
      historico: [{ mesAno: '02/2026', valorCentavos: 15000, status: 'Pendente' }],
      statusBloqueantes: MARCA_GOCASE.statusBloqueantes,
      margemParcialCentavos: MARCA_GOCASE.margemParcialCentavos,
    });
    const final = { ...ini.resultado, ...retro };
    expect(final.status).toBe('APROVADO');
    expect(final.retroativoCentavos).toBe(15000);
    expect(final.valorTotalCentavos).toBe(25000);
    expect(final.cnpjTomador).toBe(GOCASE); // preservado do inicial
    expect(final.numeroNf).toBe('123');
  });
});
