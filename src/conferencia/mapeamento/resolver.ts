/**
 * Resolução do mapeamento com **cache por perfil** (spec §6: "mapa cacheado no perfil;
 * revalida no mês novo"). O formato das planilhas é estável, então o mapa é reusado entre
 * meses; mas o link do formulário troca todo mês — por isso revalidamos o cache contra os
 * cabeçalhos atuais e só chamamos a IA quando o cache não serve mais.
 */
import type { EntradaMapeamento, MapeadorColunas, RepositorioPerfis } from '../contratos.js';
import type { MapeamentoColunas } from '../tipos.js';
import { papeisCriticosEntrada } from './papeis.js';
import { avaliarMapeamento, type AvaliacaoMapeamento, type OpcoesPolitica } from './politica.js';

/** Só o que o resolver precisa do repositório (facilita o teste com fakes). */
export type CacheMapeamento = Pick<RepositorioPerfis, 'obterMapeamento' | 'salvarMapeamento'>;

export interface DepsResolver {
  repo: CacheMapeamento;
  mapeador: MapeadorColunas;
}

export interface ResolucaoMapeamento {
  mapeamento: MapeamentoColunas;
  /** De onde veio o mapa: cache reusado ou nova chamada à IA. */
  origem: 'cache' | 'ia';
  avaliacao: AvaliacaoMapeamento;
}

function normalizar(cabecalho: string): string {
  return cabecalho.trim().toLowerCase();
}

/**
 * O cache ainda serve para estes cabeçalhos? Vale quando todos os papéis críticos de
 * **entrada** (cupom, link de NF) estão no cache e suas colunas continuam existindo no
 * cabeçalho atual (case-insensitive). Uma coluna que sumiu (mês com formato diferente)
 * invalida → re-mapeia. Colunas de saída (ex.: `status`) não entram aqui: são criadas
 * quando faltam, então não devem forçar uma nova chamada à IA.
 */
export function cacheValido(
  cache: MapeamentoColunas,
  entrada: EntradaMapeamento,
): boolean {
  const presentes = new Set(entrada.cabecalhos.map(normalizar));
  for (const papel of papeisCriticosEntrada(entrada)) {
    const mapeado = cache[papel];
    if (mapeado === undefined) return false;
    if (!presentes.has(normalizar(mapeado.coluna))) return false;
  }
  return true;
}

/**
 * Devolve o mapeamento do perfil: reusa o cache se ainda válido para os cabeçalhos
 * atuais, senão chama a IA e **persiste** o novo mapa. Em ambos os casos avalia a
 * política de confirmação (`avaliacao.precisaConfirmar`).
 */
export async function resolverMapeamento(
  deps: DepsResolver,
  perfilId: string,
  entrada: EntradaMapeamento,
  opts: OpcoesPolitica = {},
): Promise<ResolucaoMapeamento> {
  const cache = await deps.repo.obterMapeamento(perfilId);
  if (cache !== undefined && cacheValido(cache, entrada)) {
    return { mapeamento: cache, origem: 'cache', avaliacao: avaliarMapeamento(cache, entrada, opts) };
  }

  const mapeamento = await deps.mapeador.mapear(entrada);
  await deps.repo.salvarMapeamento(perfilId, mapeamento);
  return { mapeamento, origem: 'ia', avaliacao: avaliarMapeamento(mapeamento, entrada, opts) };
}
