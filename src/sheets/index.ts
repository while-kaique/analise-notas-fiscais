import type {
  TokensGoogle,
  MapaColunas,
  LinhaEntrada,
  LinhaResultado,
} from '../types/index.js';

/** Resultado da leitura de uma aba: o mapa de colunas + as linhas de dados. */
export interface LeituraPlanilha {
  /** Cabeçalho → índice 0-based. */
  mapa: MapaColunas;
  /** Linhas de dados (sem o cabeçalho). */
  linhas: LinhaEntrada[];
  /** Total de linhas de dados encontradas. */
  total: number;
}

/**
 * I/O da planilha (Google Sheets). Implementação: fatia F3.
 *
 * Contrato (ver CLAUDE.md §4):
 * - Identifica colunas por **cabeçalho**, nunca por índice fixo.
 * - `garantirColunas` cria as colunas de resultado que não existirem.
 * - `escreverResultados` usa **batchUpdate** (escrita em lote), nunca célula a célula.
 * - Nunca destrói dados do usuário: só escreve nas colunas de resultado.
 */
export interface SheetsClient {
  lerLinhas(spreadsheetId: string, aba?: string): Promise<LeituraPlanilha>;
  garantirColunas(
    spreadsheetId: string,
    headers: readonly string[],
    aba?: string,
  ): Promise<MapaColunas>;
  escreverResultados(
    spreadsheetId: string,
    resultados: readonly LinhaResultado[],
    aba?: string,
  ): Promise<void>;
}

/** Cria um `SheetsClient` autenticado a partir dos tokens OAuth do usuário. */
export type CriarSheetsClient = (tokens: TokensGoogle) => Promise<SheetsClient>;

/** Extrai o ID do spreadsheet a partir de uma URL do Google Sheets.
 *  Implementação (utilitário simples) pode viver na fatia F3. */
export type ExtrairSpreadsheetId = (url: string) => string | null;

// Implementação (fatia F3).
export { extrairSpreadsheetId } from './spreadsheet-id.js';
export {
  SheetsClientImpl,
  criarSheetsClient,
  criarSheetsClientCom,
} from './sheets-client.js';
export {
  construirMapaColunas,
  acharColuna,
  acharColunaLink,
  colunaParaA1,
  centavosParaReais,
  resultadoParaCelulas,
  CABECALHOS_LINK,
  type CelulaEscrita,
} from './colunas.js';
