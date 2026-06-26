import { describe, it, expect } from 'vitest';
import {
  montarMensagensMapeamento,
  parsearRespostaMapeamento,
  coerenciaPapelColuna,
  avaliarMapeamento,
  papeisCriticos,
  papeisCriticosEntrada,
  papeisSolicitados,
  MapeadorColunasIa,
  resolverMapeamento,
  cacheValido,
} from '../src/conferencia/index.js';
import type {
  ClienteLlm,
  MensagemLlm,
  OpcoesLlm,
  MapeadorColunas,
  EntradaMapeamento,
  CacheMapeamento,
  MapeamentoColunas,
} from '../src/conferencia/index.js';

// ───────────────────────────── Fixtures e fakes ─────────────────────────────

const CABECALHOS = [
  'Carimbo de data/hora',
  'Qual o seu cupom?',
  'NF do influenciador',
  'NF da assessoria',
];

const EXEMPLOS: Record<string, readonly string[]> = {
  'Carimbo de data/hora': ['25/06/2026 14:30:00', '24/06/2026 09:00:00'],
  'Qual o seu cupom?': ['GISELE10', 'MARIA20'],
  'NF do influenciador': ['https://drive.google.com/file/d/abc/view'],
  'NF da assessoria': ['https://drive.google.com/file/d/xyz/view'],
};

const ENTRADA: EntradaMapeamento = {
  cabecalhos: CABECALHOS,
  exemplos: EXEMPLOS,
  papeisEntrada: ['cupom', 'linkNf_influencer', 'linkNf_assessoria', 'carimbo'],
  papeisSaida: ['status'],
};

/** Mapeamento "bom" para os críticos de entrada (cupom + 2 links). */
const MAPA_BOM: MapeamentoColunas = {
  cupom: { coluna: 'Qual o seu cupom?', confianca: 0.97 },
  linkNf_influencer: { coluna: 'NF do influenciador', confianca: 0.95 },
  linkNf_assessoria: { coluna: 'NF da assessoria', confianca: 0.95 },
};

class FakeLlm implements ClienteLlm {
  readonly chamadas: { mensagens: readonly MensagemLlm[]; opts: OpcoesLlm | undefined }[] = [];
  constructor(private readonly resposta: string) {}
  async chat(mensagens: readonly MensagemLlm[], opts?: OpcoesLlm): Promise<string> {
    this.chamadas.push({ mensagens, opts });
    return this.resposta;
  }
}

class FakeMapeador implements MapeadorColunas {
  chamadas = 0;
  constructor(private readonly resultado: MapeamentoColunas) {}
  async mapear(): Promise<MapeamentoColunas> {
    this.chamadas++;
    return this.resultado;
  }
}

class FakeCache implements CacheMapeamento {
  readonly salvos = new Map<string, MapeamentoColunas>();
  obtidos = 0;
  constructor(seed?: MapeamentoColunas) {
    if (seed) this.salvos.set('perfil', seed);
  }
  async obterMapeamento(id: string): Promise<MapeamentoColunas | undefined> {
    this.obtidos++;
    return this.salvos.get(id);
  }
  async salvarMapeamento(id: string, mapa: MapeamentoColunas): Promise<void> {
    this.salvos.set(id, mapa);
  }
}

// ───────────────────────────────── Prompt ───────────────────────────────────

describe('montarMensagensMapeamento', () => {
  it('produz [system, user] e pede JSON', () => {
    const [system, user] = montarMensagensMapeamento(ENTRADA);
    expect(system?.role).toBe('system');
    expect(user?.role).toBe('user');
    expect(system?.content).toMatch(/JSON/i);
  });

  it('lista os papéis pedidos e os cabeçalhos com exemplos', () => {
    const [, user] = montarMensagensMapeamento(ENTRADA);
    const txt = user?.content ?? '';
    expect(txt).toContain('cupom');
    expect(txt).toContain('linkNf_influencer');
    expect(txt).toContain('status'); // papel de saída também entra
    expect(txt).toContain('Qual o seu cupom?');
    expect(txt).toContain('GISELE10');
  });

  it('mostra no máximo 3 exemplos por coluna', () => {
    const entrada: EntradaMapeamento = {
      ...ENTRADA,
      exemplos: { 'Qual o seu cupom?': ['A', 'B', 'C', 'D', 'E'] },
    };
    const [, user] = montarMensagensMapeamento(entrada);
    const txt = user?.content ?? '';
    expect(txt).toContain('"A"');
    expect(txt).toContain('"C"');
    expect(txt).not.toContain('"D"');
  });
});

// ───────────────────────────────── Parse ────────────────────────────────────

describe('parsearRespostaMapeamento', () => {
  const solicitados = ['cupom', 'linkNf_influencer'];

  it('mapeia uma resposta válida usando o cabeçalho canônico', () => {
    const json = '{"cupom":{"coluna":"Qual o seu cupom?","confianca":0.97}}';
    const mapa = parsearRespostaMapeamento(json, CABECALHOS, solicitados);
    expect(mapa.cupom).toEqual({ coluna: 'Qual o seu cupom?', confianca: 0.97 });
  });

  it('casa o cabeçalho de forma case-insensitive e grava o texto canônico', () => {
    const json = '{"cupom":{"coluna":"qual O SEU cupom?","confianca":0.9}}';
    const mapa = parsearRespostaMapeamento(json, CABECALHOS, solicitados);
    expect(mapa.cupom?.coluna).toBe('Qual o seu cupom?');
  });

  it('grampeia a confiança em [0,1]', () => {
    const json =
      '{"cupom":{"coluna":"Qual o seu cupom?","confianca":1.5},' +
      '"linkNf_influencer":{"coluna":"NF do influenciador","confianca":-0.3}}';
    const mapa = parsearRespostaMapeamento(json, CABECALHOS, solicitados);
    expect(mapa.cupom?.confianca).toBe(1);
    expect(mapa.linkNf_influencer?.confianca).toBe(0);
  });

  it('aceita confiança como string numérica e descarta não-numérica', () => {
    const json =
      '{"cupom":{"coluna":"Qual o seu cupom?","confianca":"0.8"},' +
      '"linkNf_influencer":{"coluna":"NF do influenciador","confianca":"alta"}}';
    const mapa = parsearRespostaMapeamento(json, CABECALHOS, solicitados);
    expect(mapa.cupom?.confianca).toBe(0.8);
    expect(mapa.linkNf_influencer).toBeUndefined();
  });

  it('descarta cabeçalho inventado e papel não solicitado', () => {
    const json =
      '{"cupom":{"coluna":"Coluna Inexistente","confianca":0.9},' +
      '"carimbo":{"coluna":"Carimbo de data/hora","confianca":0.9}}';
    const mapa = parsearRespostaMapeamento(json, CABECALHOS, solicitados);
    expect(mapa.cupom).toBeUndefined(); // coluna não existe
    expect(mapa.carimbo).toBeUndefined(); // papel não solicitado
  });

  it('lê JSON cercado por texto / cercas de código', () => {
    const json = 'Claro!\n```json\n{"cupom":{"coluna":"Qual o seu cupom?","confianca":0.9}}\n```';
    const mapa = parsearRespostaMapeamento(json, CABECALHOS, solicitados);
    expect(mapa.cupom?.coluna).toBe('Qual o seu cupom?');
  });

  it('resposta sem JSON vira mapa vazio', () => {
    expect(parsearRespostaMapeamento('não consegui mapear', CABECALHOS, solicitados)).toEqual({});
  });
});

// ─────────────────────────────── Heurísticas ────────────────────────────────

describe('coerenciaPapelColuna', () => {
  it('link com URL combina; sem URL não combina', () => {
    expect(coerenciaPapelColuna('linkNf_influencer', ['https://drive.google.com/x'])).toBe('sim');
    expect(coerenciaPapelColuna('linkNf_influencer', ['GISELE10', 'MARIA20'])).toBe('nao');
  });

  it('carimbo reusa o normalizador de datas da F1', () => {
    expect(coerenciaPapelColuna('carimbo', ['25/06/2026 14:30:00'])).toBe('sim');
    expect(coerenciaPapelColuna('carimbo', ['banana'])).toBe('nao');
  });

  it('papel sem predicado (saída) ou sem exemplos é indefinido', () => {
    expect(coerenciaPapelColuna('status', ['Aprovado'])).toBe('indef');
    expect(coerenciaPapelColuna('cupom', [])).toBe('indef');
    expect(coerenciaPapelColuna('cupom', undefined)).toBe('indef');
  });
});

// ──────────────────────────── Papéis (derivações) ───────────────────────────

describe('papéis críticos e solicitados', () => {
  it('críticos de entrada = cupom + links pedidos (sem carimbo)', () => {
    expect(papeisCriticosEntrada(ENTRADA)).toEqual([
      'cupom',
      'linkNf_influencer',
      'linkNf_assessoria',
    ]);
  });

  it('críticos completos incluem status (saída)', () => {
    expect(papeisCriticos(ENTRADA)).toContain('status');
  });

  it('solicitados unem entrada + saída sem repetir', () => {
    const sol = papeisSolicitados(ENTRADA);
    expect(sol).toContain('carimbo');
    expect(sol).toContain('status');
    expect(new Set(sol).size).toBe(sol.length);
  });
});

// ───────────────────────────────── Política ─────────────────────────────────

describe('avaliarMapeamento', () => {
  it('libera automático quando os críticos de entrada estão altos (status ausente = criar)', () => {
    const av = avaliarMapeamento(MAPA_BOM, ENTRADA);
    expect(av.precisaConfirmar).toBe(false);
    expect(av.faltando).toEqual([]);
    expect(av.saidaACriar).toEqual(['status']);
  });

  it('pede confirmação quando falta um crítico de entrada', () => {
    const { cupom: _omit, ...semCupom } = MAPA_BOM;
    const av = avaliarMapeamento(semCupom, ENTRADA);
    expect(av.precisaConfirmar).toBe(true);
    expect(av.faltando).toContain('cupom');
  });

  it('pede confirmação quando um crítico está abaixo do limiar', () => {
    const mapa: MapeamentoColunas = { ...MAPA_BOM, cupom: { coluna: 'Qual o seu cupom?', confianca: 0.5 } };
    const av = avaliarMapeamento(mapa, ENTRADA);
    expect(av.precisaConfirmar).toBe(true);
    expect(av.baixaConfianca.map((p) => p.papel)).toContain('cupom');
  });

  it('respeita um limiar customizado', () => {
    const mapa: MapeamentoColunas = { ...MAPA_BOM, cupom: { coluna: 'Qual o seu cupom?', confianca: 0.5 } };
    const av = avaliarMapeamento(mapa, ENTRADA, { limiar: 0.4 });
    expect(av.baixaConfianca).toEqual([]);
    expect(av.precisaConfirmar).toBe(false);
  });

  it('flagra incoerência: link mapeado numa coluna cujos exemplos não são URLs', () => {
    const mapa: MapeamentoColunas = {
      ...MAPA_BOM,
      linkNf_influencer: { coluna: 'Qual o seu cupom?', confianca: 0.95 },
    };
    const av = avaliarMapeamento(mapa, ENTRADA);
    expect(av.precisaConfirmar).toBe(true);
    expect(av.incoerentes.map((p) => p.papel)).toContain('linkNf_influencer');
  });
});

// ──────────────────────────────── Mapeador IA ───────────────────────────────

describe('MapeadorColunasIa', () => {
  it('chama o LLM em modo JSON, temperatura 0, e devolve o mapa parseado', async () => {
    const llm = new FakeLlm('{"cupom":{"coluna":"Qual o seu cupom?","confianca":0.9}}');
    const mapeador = new MapeadorColunasIa(llm);
    const mapa = await mapeador.mapear(ENTRADA);
    expect(mapa.cupom?.coluna).toBe('Qual o seu cupom?');
    expect(llm.chamadas).toHaveLength(1);
    expect(llm.chamadas[0]?.opts?.jsonMode).toBe(true);
    expect(llm.chamadas[0]?.opts?.temperature).toBe(0);
  });

  it('JSON malformado da IA vira mapa vazio (não lança)', async () => {
    const llm = new FakeLlm('desculpe, não sei');
    const mapeador = new MapeadorColunasIa(llm);
    await expect(mapeador.mapear(ENTRADA)).resolves.toEqual({});
  });
});

// ────────────────────────── Resolver (cache por perfil) ─────────────────────

describe('cacheValido', () => {
  it('vale quando os críticos de entrada existem nos cabeçalhos atuais', () => {
    expect(cacheValido(MAPA_BOM, ENTRADA)).toBe(true);
  });

  it('inválido se um crítico de entrada some do cabeçalho (mês com outro formato)', () => {
    const cache: MapeamentoColunas = { ...MAPA_BOM, cupom: { coluna: 'Cupom antigo', confianca: 0.97 } };
    expect(cacheValido(cache, ENTRADA)).toBe(false);
  });

  it('inválido se faltar um crítico de entrada no cache', () => {
    const { linkNf_assessoria: _omit, ...incompleto } = MAPA_BOM;
    expect(cacheValido(incompleto, ENTRADA)).toBe(false);
  });
});

describe('resolverMapeamento', () => {
  it('sem cache: chama a IA, persiste e marca origem "ia"', async () => {
    const repo = new FakeCache();
    const mapeador = new FakeMapeador(MAPA_BOM);
    const r = await resolverMapeamento({ repo, mapeador }, 'perfil', ENTRADA);
    expect(r.origem).toBe('ia');
    expect(mapeador.chamadas).toBe(1);
    expect(repo.salvos.get('perfil')).toEqual(MAPA_BOM);
  });

  it('cache válido: reusa sem chamar a IA', async () => {
    const repo = new FakeCache(MAPA_BOM);
    const mapeador = new FakeMapeador({});
    const r = await resolverMapeamento({ repo, mapeador }, 'perfil', ENTRADA);
    expect(r.origem).toBe('cache');
    expect(mapeador.chamadas).toBe(0);
    expect(r.mapeamento).toEqual(MAPA_BOM);
  });

  it('cache inválido (coluna sumiu): re-mapeia e regrava', async () => {
    const cacheVelho: MapeamentoColunas = {
      ...MAPA_BOM,
      cupom: { coluna: 'Cupom antigo', confianca: 0.97 },
    };
    const repo = new FakeCache(cacheVelho);
    const mapeador = new FakeMapeador(MAPA_BOM);
    const r = await resolverMapeamento({ repo, mapeador }, 'perfil', ENTRADA);
    expect(r.origem).toBe('ia');
    expect(mapeador.chamadas).toBe(1);
    expect(repo.salvos.get('perfil')).toEqual(MAPA_BOM);
  });
});
