import type { MapaColunas, LinhaResultado } from '../types/index.js';
import { COLUNAS } from '../types/index.js';

/**
 * Funções **puras** de manipulação de colunas/células da planilha.
 * Sem I/O — toda a lógica testável da F3 (mapa por cabeçalho, A1, escrita) vive aqui.
 */

/** Cabeçalhos (case-insensitive) reconhecidos como a coluna de link do arquivo. */
export const CABECALHOS_LINK: readonly string[] = [
  'Link',
  'Link Arquivo',
  'Link da Nota',
  'Link NF',
  'Arquivo',
  'URL',
];

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

/** Acha a primeira coluna de link entre os candidatos de {@link CABECALHOS_LINK}. */
export function acharColunaLink(mapa: MapaColunas): number | null {
  for (const candidato of CABECALHOS_LINK) {
    const indice = acharColuna(mapa, candidato);
    if (indice !== null) return indice;
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

/** Valor em centavos (inteiro) → reais como número (ex.: 123456 → 1234.56). */
export function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

/** Prefixo de range A1 com a aba entre aspas simples, quando informada. */
function prefixoAba(aba: string | undefined): string {
  if (aba === undefined || aba.trim() === '') return '';
  return `'${aba.replace(/'/g, "''")}'!`;
}

/** Um intervalo A1 + valor a escrever (formato do `values.batchUpdate`). */
export interface CelulaEscrita {
  range: string;
  /** Valor já normalizado para a célula (string vazia limpa valor anterior). */
  valor: string | number;
}

/**
 * Mapeia um {@link LinhaResultado} para as células a escrever, **apenas** nas
 * colunas de resultado presentes no mapa. Campos ausentes viram string vazia
 * (limpa resíduo de um processamento anterior — idempotência). Nunca toca em
 * colunas fora de {@link COLUNAS}, preservando os dados do usuário (CLAUDE.md §4).
 */
export function resultadoParaCelulas(
  resultado: LinhaResultado,
  mapa: MapaColunas,
  aba?: string,
): CelulaEscrita[] {
  const linha = resultado.numeroLinha;
  const nota = resultado.nota;

  const valores: Record<string, string | number> = {
    [COLUNAS.status]: resultado.status,
    [COLUNAS.cnpjEmitente]: nota?.cnpjEmitente ?? '',
    [COLUNAS.dataEmissao]: nota?.dataEmissao ?? '',
    [COLUNAS.valor]: nota ? centavosParaReais(nota.valorTotalCentavos) : '',
    [COLUNAS.erro]: resultado.erro ?? '',
    [COLUNAS.processadoEm]: resultado.processadoEm,
  };

  const celulas: CelulaEscrita[] = [];
  for (const [cabecalho, valor] of Object.entries(valores)) {
    const indice = acharColuna(mapa, cabecalho);
    if (indice === null) continue; // coluna não existe nesta aba: pula
    celulas.push({
      range: `${prefixoAba(aba)}${colunaParaA1(indice)}${linha}`,
      valor,
    });
  }
  return celulas;
}
