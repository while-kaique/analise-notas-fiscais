/**
 * Catálogo de **papéis de coluna** do mapeamento por IA (spec §6) e utilitários puros.
 *
 * Um "papel" é um nome lógico (ex.: `cupom`, `linkNf_influencer`, `status`) que a IA
 * precisa localizar no cabeçalho real do formulário — que muda de marca para marca.
 * Aqui só ficam descrições/constantes/derivações **puras**; a chamada à IA está em
 * `mapeador-ia.ts` e a política de confirmação em `politica.ts`.
 */
import type { EntradaMapeamento } from '../contratos.js';
import type { PapelColunaEntrada, ColunasSaida } from '../tipos.js';

/** Limiar de confiança padrão para processar sem pedir confirmação (spec §6, decisão 3). */
export const LIMIAR_CONFIANCA_PADRAO = 0.8;

/** Os papéis de link de NF (um deles é o "link da NF" crítico de cada frente). */
export const PAPEIS_LINK_NF: readonly PapelColunaEntrada[] = [
  'linkNf_influencer',
  'linkNf_assessoria',
  'linkNf_unica',
];

/**
 * Descrição em PT-BR de cada papel, usada no prompt para a IA entender o que procurar.
 * Cobre papéis de **entrada** (`PapelColunaEntrada`) e de **saída** (`keyof ColunasSaida`).
 */
export const DESCRICOES_PAPEL: Readonly<Record<string, string>> = {
  // Entrada (lidos do formulário)
  cupom:
    'Código do cupom do influencer/embaixador (ex.: GISELE10, MARIA_20). Costuma ser curto, ' +
    'alfanumérico e sem espaços; a pergunta pode citar "cupom" ou "código".',
  linkNf_influencer:
    'Link/URL do arquivo da nota fiscal enviada pelo INFLUENCER (geralmente um link do Google Drive).',
  linkNf_assessoria:
    'Link/URL do arquivo da nota fiscal enviada pela ASSESSORIA/agência (geralmente um link do Google Drive).',
  linkNf_unica:
    'Link/URL do arquivo da nota fiscal quando o formulário tem um único campo de NF por linha.',
  carimbo:
    'Carimbo de data/hora da resposta do formulário (ex.: "25/06/2026 14:30:00"). ' +
    'Em formulários Google costuma se chamar "Carimbo de data/hora".',
  // Saída (escritos de volta pelo sistema; criados se não existirem)
  status: 'Coluna onde o resultado da conferência é escrito (Aprovado/Parcial/Não Aprovado).',
  cnpjTomador: 'Coluna do CNPJ do tomador do serviço extraído da nota.',
  valorNf: 'Coluna do valor da nota fiscal extraído.',
  retroativo: 'Coluna do valor retroativo acumulado de meses anteriores.',
  valorEsperado: 'Coluna do valor esperado vindo da base/controle.',
  valorTotal: 'Coluna do valor total esperado (esperado + retroativo).',
  dataNf: 'Coluna da data de emissão da nota fiscal.',
  numeroNf: 'Coluna do número da nota fiscal.',
};

/** Descrição do papel (fallback para o próprio nome se não catalogado). */
export function descricaoPapel(papel: string): string {
  return DESCRICOES_PAPEL[papel] ?? papel;
}

/** Todos os papéis solicitados na entrada (entrada + saída), sem repetição. */
export function papeisSolicitados(entrada: EntradaMapeamento): string[] {
  const todos: string[] = [...entrada.papeisEntrada, ...entrada.papeisSaida];
  return [...new Set(todos)];
}

/**
 * Papéis críticos de **entrada** (lidos do formulário): `cupom` e o(s) link(s) de NF da
 * frente. Precisam existir para processar — sem eles não dá para ler cupom/baixar a NF.
 * Uma frente SOMA, por exemplo, não pede link de NF.
 */
export function papeisCriticosEntrada(entrada: EntradaMapeamento): string[] {
  const criticos: string[] = [];
  const entradaSet = new Set<string>(entrada.papeisEntrada);
  if (entradaSet.has('cupom')) criticos.push('cupom');
  for (const link of PAPEIS_LINK_NF) {
    if (entradaSet.has(link)) criticos.push(link);
  }
  return criticos;
}

/**
 * Todos os papéis **críticos** para liberar o processamento automático (spec §6,
 * decisão 3): os de entrada ({@link papeisCriticosEntrada}) mais a coluna de `status`.
 * `status` é coluna de saída — se faltar é criada, mas se existir de forma ambígua a
 * política pede confirmação (ver `politica.ts`).
 */
export function papeisCriticos(entrada: EntradaMapeamento): string[] {
  const criticos = papeisCriticosEntrada(entrada);
  const status: keyof ColunasSaida = 'status';
  if (entrada.papeisSaida.includes(status)) criticos.push(status);
  return criticos;
}
