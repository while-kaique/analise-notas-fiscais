import { describe, it, expect } from 'vitest';
import { validarCnpj } from '../src/parsing/index.js';
import {
  MARCA_GOCASE,
  MARCA_GOBEAUTE,
  MARCAS_SEED,
  PERFIS_SEED,
  colunasSaidaPadrao,
  RepositorioPerfisMemoria,
} from '../src/conferencia/index.js';
import type { Frente } from '../src/conferencia/index.js';

function frente(perfilId: string, tipo: Frente['tipo']): Frente | undefined {
  return PERFIS_SEED.find((p) => p.id === perfilId)?.frentes.find((f) => f.tipo === tipo);
}

describe('seed de marcas/perfis', () => {
  it('Gocase tem CNPJ do tomador com DV válido', () => {
    expect(MARCA_GOCASE.cnpjTomador).toBe('22165464000190');
    expect(validarCnpj(MARCA_GOCASE.cnpjTomador)).toBe(true);
  });

  it('Gocase usa os status bloqueantes e a margem parcial do n8n/decisão', () => {
    expect(MARCA_GOCASE.statusBloqueantes).toEqual([
      'NF Paga',
      'Cash In Pago',
      'Lançado no Pipe',
      'NF Recebida',
    ]);
    expect(MARCA_GOCASE.margemParcialCentavos).toBe(3000);
  });

  it('Gobeaute é esqueleto (TODO): sem CNPJ nem base preenchidos', () => {
    expect(MARCA_GOBEAUTE.cnpjTomador).toBe('');
    const influ = PERFIS_SEED.find((p) => p.id === 'gobeaute-influencers');
    expect(influ?.base.spreadsheetId).toBe('');
  });

  it('o perfil de Influencers roda INFLUS → ASSESSORIA → SOMA, nessa ordem', () => {
    const perfil = PERFIS_SEED.find((p) => p.id === 'gocase-influencers');
    expect(perfil?.frentes.map((f) => f.tipo)).toEqual(['INFLUS', 'ASSESSORIA', 'SOMA']);
    expect(perfil?.base.aba).toBe('CONTROLE DE NF - INFLUS');
  });

  it('o perfil de Embaixadores tem só EMBAIXADOR (nunca tem assessoria)', () => {
    const perfil = PERFIS_SEED.find((p) => p.id === 'gocase-embaixadores');
    expect(perfil?.frentes.map((f) => f.tipo)).toEqual(['EMBAIXADOR']);
  });

  it('INFLUS lê a coluna do influencer e exclui LOURDES/ANAJULIAMELO', () => {
    const f = frente('gocase-influencers', 'INFLUS');
    expect(f?.papelLinkNf).toBe('influencer');
    expect(f?.exclusoesCupom).toContain('LOURDES');
    expect(f?.exclusoesCupom).toContain('ANAJULIAMELO');
    expect(f?.colunasSaida?.status).toBe('Status (influ)');
  });

  it('ASSESSORIA lê a coluna da assessoria e exclui STEVIEGAS', () => {
    const f = frente('gocase-influencers', 'ASSESSORIA');
    expect(f?.papelLinkNf).toBe('assessoria');
    expect(f?.exclusoesCupom).toEqual(['STEVIEGAS']);
    expect(f?.colunasSaida?.status).toBe('Status (assessoria)');
  });

  it('SOMA não baixa NF nem tem colunas próprias (escreve nos status influ/assessoria)', () => {
    const f = frente('gocase-influencers', 'SOMA');
    expect(f?.papelLinkNf).toBeUndefined();
    expect(f?.colunasSaida).toBeUndefined();
  });

  it('EMBAIXADOR exclui os cupons fixos do n8n', () => {
    const f = frente('gocase-embaixadores', 'EMBAIXADOR');
    expect(f?.papelLinkNf).toBe('unica');
    expect(f?.exclusoesCupom).toEqual([
      'Danielly',
      'MANDICAROLINNA',
      'CAMISJUNG',
      'VITORIAFONSECAB',
    ]);
  });
});

describe('colunasSaidaPadrao', () => {
  it('aplica o sufixo e mantém "Valor Esperado" compartilhado', () => {
    const influ = colunasSaidaPadrao('(influ)');
    expect(influ.status).toBe('Status (influ)');
    expect(influ.cnpjTomador).toBe('CNPJ Tomador (influ)');
    expect(influ.valorTotal).toBe('Valor Total (influ)');
    expect(influ.valorEsperado).toBe('Valor Esperado');
  });

  it('sem sufixo (Embaixador) gera nomes limpos', () => {
    const e = colunasSaidaPadrao();
    expect(e.status).toBe('Status');
    expect(e.valorNf).toBe('Valor NF');
    expect(e.numeroNf).toBe('Número NF');
  });
});

describe('RepositorioPerfisMemoria', () => {
  it('lista as marcas e perfis semeados', async () => {
    const repo = new RepositorioPerfisMemoria();
    expect((await repo.listarMarcas()).map((m) => m.id).sort()).toEqual(['gobeaute', 'gocase']);
    expect((await repo.listarPerfis('gocase')).length).toBe(2);
  });

  it('obterPerfil devolve cópia (mutação externa não vaza para o repositório)', async () => {
    const repo = new RepositorioPerfisMemoria();
    const p1 = await repo.obterPerfil('gocase-influencers');
    expect(p1).toBeDefined();
    p1!.nome = 'ALTERADO';
    const p2 = await repo.obterPerfil('gocase-influencers');
    expect(p2?.nome).toBe('Gocase · Influencers');
  });

  it('atualizarFormUrl persiste o link do mês', async () => {
    const repo = new RepositorioPerfisMemoria();
    await repo.atualizarFormUrl('gocase-influencers', 'https://docs.google.com/spreadsheets/d/ABC');
    const p = await repo.obterPerfil('gocase-influencers');
    expect(p?.formSheetUrl).toBe('https://docs.google.com/spreadsheets/d/ABC');
  });

  it('cacheia e devolve o mapeamento de colunas por perfil', async () => {
    const repo = new RepositorioPerfisMemoria();
    await repo.salvarMapeamento('gocase-influencers', {
      cupom: { coluna: 'Qual seu CUPOM?', confianca: 0.98 },
    });
    const mapa = await repo.obterMapeamento('gocase-influencers');
    expect(mapa?.cupom?.coluna).toBe('Qual seu CUPOM?');
  });

  it('lança em perfil inexistente e devolve undefined no obter', async () => {
    const repo = new RepositorioPerfisMemoria();
    expect(await repo.obterPerfil('nao-existe')).toBeUndefined();
    await expect(repo.atualizarFormUrl('nao-existe', 'x')).rejects.toThrow(/Perfil não encontrado/);
  });
});
