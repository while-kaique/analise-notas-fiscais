/**
 * Seed dos perfis/marcas (spec §3). Dados reais extraídos dos fluxos n8n
 * (`fluxos_n8n/*.json`). Gocase completo; **Gobeaute é esqueleto** (task futura — §10):
 * mesma forma, sem IDs/CNPJ reais (marcados `TODO`).
 */
import type { ColunasSaida, Marca, Perfil } from '../tipos.js';

/** Status que param a acumulação retroativa (spec §4.4) — comuns às marcas Gocase no n8n. */
export const STATUS_BLOQUEANTES_PADRAO = [
  'NF Paga',
  'Cash In Pago',
  'Lançado no Pipe',
  'NF Recebida',
] as const;

/** Margem para "Parcial": diferença até R$ 30,00 (spec §2.5). */
export const MARGEM_PARCIAL_CENTAVOS = 3000;

/**
 * Prefixo das colunas que o bot CRIA/ESCREVE no formulário. Garante que os nomes nunca
 * colidam com colunas nativas do formulário (ex.: "Status", "Observações", "N° do chamado"):
 * assim o bot não sobrescreve dados do usuário (§4) e a idempotência (`merge.ts`) lê a SUA
 * própria coluna de status — e não a do formulário, que já vem preenchida (senão pularia tudo).
 */
export const PREFIXO_COLUNA_SAIDA = 'bot_';

/**
 * Monta as colunas de saída padronizadas (spec §4.5), todas com {@link PREFIXO_COLUNA_SAIDA}.
 * `sufixo` distingue frentes que dividem o mesmo formulário (`(influ)`/`(assessoria)`); vazio
 * para o Embaixador. `Valor Esperado` é compartilhado (não recebe sufixo).
 */
export function colunasSaidaPadrao(sufixo = ''): ColunasSaida {
  const s = sufixo ? ` ${sufixo}` : '';
  const p = PREFIXO_COLUNA_SAIDA;
  return {
    status: `${p}Status${s}`,
    cnpjTomador: `${p}CNPJ Tomador${s}`,
    valorNf: `${p}Valor NF${s}`,
    retroativo: `${p}Retroativo${s}`,
    valorEsperado: `${p}Valor Esperado`,
    valorTotal: `${p}Valor Total${s}`,
    dataNf: `${p}Data NF${s}`,
    numeroNf: `${p}Número NF${s}`,
  };
}

// ─────────────────────────────────────── Gocase ───────────────────────────────────────

export const MARCA_GOCASE: Marca = {
  id: 'gocase',
  nome: 'Gocase',
  cnpjTomador: '22165464000190',
  statusBloqueantes: STATUS_BLOQUEANTES_PADRAO,
  margemParcialCentavos: MARGEM_PARCIAL_CENTAVOS,
};

const PERFIL_GOCASE_INFLUENCERS: Perfil = {
  id: 'gocase-influencers',
  marcaId: 'gocase',
  nome: 'Gocase · Influencers',
  base: {
    spreadsheetId: '1je8-9QVvc-6lE4UI0UeRJ1FQPyoCrwATdTXFiOpdtvE',
    aba: 'CONTROLE DE NF - INFLUS',
  },
  frentes: [
    {
      tipo: 'INFLUS',
      papelLinkNf: 'influencer',
      exclusoesCupom: ['LOURDES', 'ANAJULIAMELO'],
      colunasSaida: colunasSaidaPadrao('(influ)'),
    },
    {
      tipo: 'ASSESSORIA',
      papelLinkNf: 'assessoria',
      exclusoesCupom: ['STEVIEGAS'],
      colunasSaida: colunasSaidaPadrao('(assessoria)'),
    },
    {
      tipo: 'SOMA',
      exclusoesCupom: [],
    },
  ],
};

const PERFIL_GOCASE_EMBAIXADORES: Perfil = {
  id: 'gocase-embaixadores',
  marcaId: 'gocase',
  nome: 'Gocase · Embaixadores',
  base: {
    spreadsheetId: '1-rvk93tk1BYGMwVRM3HldhmMtntRr8CnjVpHQO8PIMY',
    aba: 'CONTROLE NF',
  },
  frentes: [
    {
      tipo: 'EMBAIXADOR',
      papelLinkNf: 'unica',
      exclusoesCupom: ['Danielly', 'MANDICAROLINNA', 'CAMISJUNG', 'VITORIAFONSECAB'],
      colunasSaida: colunasSaidaPadrao(),
    },
  ],
};

// ────────────────────────────── Gobeaute (esqueleto — TODO) ────────────────────────────
// TASK FUTURA (spec §10): preencher spreadsheetId/aba das bases, cnpjTomador e exclusões.
// A forma espelha o Gocase (decisão do usuário em 2026-06-26).

export const MARCA_GOBEAUTE: Marca = {
  id: 'gobeaute',
  nome: 'Gobeaute',
  cnpjTomador: '', // TODO: CNPJ do tomador da Gobeaute
  statusBloqueantes: STATUS_BLOQUEANTES_PADRAO,
  margemParcialCentavos: MARGEM_PARCIAL_CENTAVOS,
};

const PERFIL_GOBEAUTE_INFLUENCERS: Perfil = {
  id: 'gobeaute-influencers',
  marcaId: 'gobeaute',
  nome: 'Gobeaute · Influencers',
  base: { spreadsheetId: '', aba: '' }, // TODO: base de influencers da Gobeaute
  frentes: [
    { tipo: 'INFLUS', papelLinkNf: 'influencer', exclusoesCupom: [], colunasSaida: colunasSaidaPadrao('(influ)') },
    { tipo: 'ASSESSORIA', papelLinkNf: 'assessoria', exclusoesCupom: [], colunasSaida: colunasSaidaPadrao('(assessoria)') },
    { tipo: 'SOMA', exclusoesCupom: [] },
  ],
};

const PERFIL_GOBEAUTE_EMBAIXADORES: Perfil = {
  id: 'gobeaute-embaixadores',
  marcaId: 'gobeaute',
  nome: 'Gobeaute · Embaixadores',
  base: { spreadsheetId: '', aba: '' }, // TODO: base de embaixadores da Gobeaute
  frentes: [
    { tipo: 'EMBAIXADOR', papelLinkNf: 'unica', exclusoesCupom: [], colunasSaida: colunasSaidaPadrao() },
  ],
};

// ─────────────────────────────────────── Export ────────────────────────────────────────

export const MARCAS_SEED: readonly Marca[] = [MARCA_GOCASE, MARCA_GOBEAUTE];

export const PERFIS_SEED: readonly Perfil[] = [
  PERFIL_GOCASE_INFLUENCERS,
  PERFIL_GOCASE_EMBAIXADORES,
  PERFIL_GOBEAUTE_INFLUENCERS,
  PERFIL_GOBEAUTE_EMBAIXADORES,
];
