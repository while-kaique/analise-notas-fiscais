import { describe, it, expect } from 'vitest';
import type {
  BaixadorNf,
  EntradaMapeamento,
  EscritaCelula,
  LeitorPlanilha,
  MapeadorColunas,
  PlanilhaRef,
  RegistroPlanilha,
} from '../src/conferencia/contratos.js';
import type { CamposNfBrutos, MapeamentoColunas } from '../src/conferencia/index.js';
import { MARCA_GOCASE, colunasSaidaPadrao } from '../src/conferencia/index.js';
import type { ExtracaoNf } from '../src/conferencia/extracao/index.js';
import type { CacheMapeamento } from '../src/conferencia/mapeamento/index.js';
import { processarFrente, processarSoma } from '../src/conferencia/pipeline/index.js';
import type { DepsPipeline } from '../src/conferencia/pipeline/index.js';

/** LeitorPlanilha fake: planilhas em memória; `escrever` muta as linhas. */
class FakeLeitor implements LeitorPlanilha {
  cab = new Map<string, string[]>();
  rows = new Map<string, Map<number, Record<string, string>>>();

  set(id: string, cabecalho: string[], registros: RegistroPlanilha[]): void {
    this.cab.set(id, [...cabecalho]);
    const m = new Map<number, Record<string, string>>();
    for (const r of registros) m.set(r.numeroLinha, { ...r.valores });
    this.rows.set(id, m);
  }
  lerCabecalho(ref: PlanilhaRef): Promise<string[]> {
    return Promise.resolve([...(this.cab.get(ref.spreadsheetId) ?? [])]);
  }
  lerRegistros(ref: PlanilhaRef): Promise<RegistroPlanilha[]> {
    const m = this.rows.get(ref.spreadsheetId) ?? new Map();
    return Promise.resolve(
      [...m.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([numeroLinha, valores]) => ({ numeroLinha, valores: { ...valores } })),
    );
  }
  garantirColunas(ref: PlanilhaRef, colunas: readonly string[]): Promise<void> {
    const c = this.cab.get(ref.spreadsheetId) ?? [];
    for (const col of colunas) if (!c.includes(col)) c.push(col);
    this.cab.set(ref.spreadsheetId, c);
    return Promise.resolve();
  }
  escrever(ref: PlanilhaRef, escritas: readonly EscritaCelula[]): Promise<void> {
    const m = this.rows.get(ref.spreadsheetId) ?? new Map<number, Record<string, string>>();
    for (const e of escritas) {
      const row = m.get(e.numeroLinha) ?? {};
      row[e.coluna] = e.valor;
      m.set(e.numeroLinha, row);
    }
    this.rows.set(ref.spreadsheetId, m);
    return Promise.resolve();
  }
}

const COLS_FORM: Record<string, string> = {
  cupom: 'Cupom?',
  linkNf_influencer: 'LinkInflu',
  linkNf_assessoria: 'LinkAssess',
};
const mapeador: MapeadorColunas = {
  mapear: (entrada: EntradaMapeamento) => {
    const m: MapeamentoColunas = {};
    for (const p of entrada.papeisEntrada) {
      const coluna = COLS_FORM[p];
      if (coluna) m[p] = { coluna, confianca: 1 };
    }
    return Promise.resolve(m);
  },
};

function cacheVazio(): CacheMapeamento {
  const store = new Map<string, MapeamentoColunas>();
  return {
    obterMapeamento: (k) => Promise.resolve(store.get(k)),
    salvarMapeamento: (k, m) => {
      store.set(k, m);
      return Promise.resolve();
    },
  };
}

function extracaoFake(porLink: Record<string, CamposNfBrutos>): ExtracaoNf {
  return { extrairDoPdf: (_bytes, hash) => Promise.resolve(porLink[hash ?? ''] ?? {}) };
}

const baixador: BaixadorNf = {
  baixar: (link) =>
    Promise.resolve({ bytes: new Uint8Array([1]), hash: link, tipo: 'pdf', tamanhoBytes: 1 }),
};

const GOCASE = '22165464000190';
const baseRef: PlanilhaRef = { spreadsheetId: 'BASEID', aba: 'CONTROLE' };
const formRef: PlanilhaRef = { spreadsheetId: 'FORMID', aba: '0' };

function baseLinha(
  numeroLinha: number,
  c: string,
  v: string,
  s: string,
  m: string,
  id: string,
): RegistroPlanilha {
  return { numeroLinha, valores: { Cupom: c, 'Valor NF': v, Status: s, 'Mês/Ano': m, ID: id } };
}

describe('processarFrente (INFLUS)', () => {
  function montarCenario() {
    const leitor = new FakeLeitor();
    leitor.set('BASEID', ['Cupom', 'Valor NF', 'Status', 'Mês/Ano', 'ID'], [
      baseLinha(2, 'LARISSA', '100,00', '', '05/2026', '1'),
      baseLinha(3, 'MARIA', '50,00', '', '05/2026', '2'),
      baseLinha(4, 'MARIA', '30,00', '', '04/2026', '3'),
      baseLinha(5, 'JOAO', '20,00', '', '05/2026', '4'),
    ]);
    leitor.set('FORMID', ['Cupom?', 'LinkInflu'], [
      { numeroLinha: 2, valores: { 'Cupom?': 'Larissa', LinkInflu: 'L1' } },
      { numeroLinha: 3, valores: { 'Cupom?': 'Maria', LinkInflu: 'L2' } },
      { numeroLinha: 4, valores: { 'Cupom?': 'Joao', LinkInflu: 'L3' } },
    ]);
    const deps: DepsPipeline = {
      leitor,
      baixador,
      extracao: extracaoFake({
        L1: { CNPJ1: '00000000000000', CNPJ2: GOCASE, Valor: 100.0 },
        L2: { CNPJ1: '00000000000000', CNPJ2: GOCASE, Valor: 80.0 },
        L3: { CNPJ1: '11111111111111', CNPJ2: '99999999999999', Valor: 20.0 },
      }),
      mapeador,
      cacheMapa: cacheVazio(),
    };
    const frente = {
      tipo: 'INFLUS' as const,
      papelLinkNf: 'influencer' as const,
      exclusoesCupom: [],
      colunasSaida: colunasSaidaPadrao('(influ)'),
    };
    const ctx = { perfilId: 'p', baseRef, formRef, frente, marca: MARCA_GOCASE, mesAlvo: '05/2026' };
    return { leitor, deps, ctx };
  }

  it('classifica APROVADO, retroativo e CNPJ diferente; grava no formulário', async () => {
    const { leitor, deps, ctx } = montarCenario();
    const res = await processarFrente(ctx, deps);

    expect(res.precisaConfirmarMapeamento).toBe(false);
    const porCupom = Object.fromEntries(res.resultados.map((r) => [r.cupom, r]));

    expect(porCupom['LARISSA']?.status).toBe('APROVADO');

    expect(porCupom['MARIA']?.status).toBe('APROVADO'); // 50 + 30 retroativo = 80
    expect(porCupom['MARIA']?.retroativoCentavos).toBe(3000);
    expect(porCupom['MARIA']?.mesesRetroativos).toEqual(['04/2026']);

    expect(porCupom['JOAO']?.status).toBe('CNPJ_DIFERENTE');

    // gravou de volta no formulário (rótulo pt-BR na coluna configurada)
    const linha2 = (await leitor.lerRegistros(formRef)).find((r) => r.numeroLinha === 2);
    expect(linha2?.valores['bot_Status (influ)']).toBe('Aprovado');
    expect(leitor.cab.get('FORMID')).toContain('bot_Valor NF (influ)');
  });

  it('é idempotente: reprocessar não refaz linhas já com status', async () => {
    const { leitor, deps, ctx } = montarCenario();
    await processarFrente(ctx, deps);
    const segundo = await processarFrente(ctx, deps);
    expect(segundo.resultados).toHaveLength(0);
  });
});

describe('processarSoma', () => {
  it('aprova o cupom quando influ + assessoria batem com a base', async () => {
    const leitor = new FakeLeitor();
    leitor.set('BASEID', ['Cupom', 'Valor NF', 'Status', 'Mês/Ano', 'ID'], [
      baseLinha(2, 'ANA', '100,00', '', '05/2026', '1'),
    ]);
    const influ = colunasSaidaPadrao('(influ)');
    const assessoria = colunasSaidaPadrao('(assessoria)');
    leitor.set(
      'FORMID',
      ['Cupom?', influ.status, assessoria.status, influ.valorNf, assessoria.valorNf],
      [
        {
          numeroLinha: 2,
          valores: {
            'Cupom?': 'Ana',
            [influ.status]: 'Não Aprovado',
            [assessoria.status]: 'Não Aprovado',
            [influ.valorNf]: '60,00',
            [assessoria.valorNf]: '40,00',
          },
        },
      ],
    );
    const deps: DepsPipeline = {
      leitor,
      baixador,
      extracao: extracaoFake({}),
      mapeador,
      cacheMapa: cacheVazio(),
    };
    const res = await processarSoma(
      { perfilId: 'p', baseRef, formRef, influ, assessoria, marca: MARCA_GOCASE, mesAlvo: '05/2026' },
      deps,
    );

    expect(res.resultados[0]?.status).toBe('APROVADO');
    const linha = (await leitor.lerRegistros(formRef)).find((r) => r.numeroLinha === 2);
    expect(linha?.valores[influ.status]).toBe('Aprovado');
    expect(linha?.valores[assessoria.status]).toBe('Aprovado');
  });
});
