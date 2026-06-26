/**
 * Funções **puras** de manipulação de colunas/células da planilha (mapa por
 * cabeçalho, notação A1). Sem I/O. Reusadas pela conferência v2
 * (`conferencia/sheets/leitor-planilha-rest.ts`) — ver CLAUDE.md §4: colunas são
 * identificadas por **nome**, nunca por posição.
 */

/** Mapa cabeçalho → índice 0-based de uma linha de cabeçalho de planilha. */
export type MapaColunas = Record<string, number>;

/** Normaliza um cabeçalho para comparação: trim + minúsculas. */
function normalizar(cabecalho: string): string {
  return cabecalho.trim().toLowerCase();
}

/**
 * Constrói o mapa cabeçalho → índice 0-based a partir da linha de cabeçalho.
 * Identifica colunas por **nome**, nunca por posição (CLAUDE.md §4). Em caso de
 * cabeçalhos repetidos, a **primeira** ocorrência vence; células vazias são ignoradas.
 */
export function construirMapaColunas(headers: readonly string[]): MapaColunas {
  const mapa: MapaColunas = {};
  headers.forEach((bruto, indice) => {
    const nome = (bruto ?? '').trim();
    if (nome === '') return;
    if (!(nome in mapa)) mapa[nome] = indice;
  });
  return mapa;
}

/** Acha o índice de um cabeçalho no mapa de forma case-insensitive; `null` se ausente. */
export function acharColuna(mapa: MapaColunas, cabecalho: string): number | null {
  const alvo = normalizar(cabecalho);
  for (const [nome, indice] of Object.entries(mapa)) {
    if (normalizar(nome) === alvo) return indice;
  }
  return null;
}

/**
 * Converte um índice de coluna 0-based para a notação A1 (0→A, 25→Z, 26→AA…).
 */
export function colunaParaA1(indice0: number): string {
  if (!Number.isInteger(indice0) || indice0 < 0) {
    throw new Error(`Índice de coluna inválido: ${indice0}`);
  }
  let n = indice0;
  let letras = '';
  do {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letras;
}
