/**
 * Heurísticas **puras** de coerência papel↔coluna (spec §6: "validações/regex por papel
 * reusam F1"). Cruzam os valores de exemplo de uma coluna com o que se espera do papel,
 * para flagrar um casamento da IA que claramente não combina (ex.: papel de link mapeado
 * numa coluna cujos exemplos não são URLs). É um **sinal**, não um veredito: só dá `'nao'`
 * quando há exemplos e nenhum combina; sem exemplos, `'indef'`.
 */
import { normalizarData } from '../../parsing/index.js';
import { PAPEIS_LINK_NF } from './papeis.js';

/** Resultado da checagem: combina, não combina, ou indefinido (sem base p/ julgar). */
export type Coerencia = 'sim' | 'nao' | 'indef';

const RE_URL = /^https?:\/\/\S+$/i;

/** Parece um link http(s) (os links de NF do form são URLs do Drive). */
function pareceUrl(valor: string): boolean {
  return RE_URL.test(valor.trim());
}

/** Parece um cupom: não vazio, curto e sem espaços internos. */
function pareceCupom(valor: string): boolean {
  const v = valor.trim();
  return v.length > 0 && v.length <= 40 && !/\s/.test(v);
}

/** Parece um carimbo de data/hora — reusa o normalizador de datas da F1. */
function pareceCarimbo(valor: string): boolean {
  return normalizarData(valor) !== null;
}

/** O predicado de coerência de cada papel (papéis sem predicado não são checados). */
function predicadoDoPapel(papel: string): ((v: string) => boolean) | undefined {
  if (papel === 'cupom') return pareceCupom;
  if (papel === 'carimbo') return pareceCarimbo;
  if ((PAPEIS_LINK_NF as readonly string[]).includes(papel)) return pareceUrl;
  return undefined;
}

/**
 * Os exemplos da coluna combinam com o papel?
 * - sem predicado para o papel (ex.: colunas de saída) → `'indef'`;
 * - sem exemplos não vazios → `'indef'`;
 * - algum exemplo combina → `'sim'`; nenhum combina → `'nao'`.
 */
export function coerenciaPapelColuna(papel: string, valores: readonly string[] | undefined): Coerencia {
  const predicado = predicadoDoPapel(papel);
  if (predicado === undefined) return 'indef';

  const limpos = (valores ?? []).map((v) => v.trim()).filter((v) => v !== '');
  if (limpos.length === 0) return 'indef';

  return limpos.some(predicado) ? 'sim' : 'nao';
}
