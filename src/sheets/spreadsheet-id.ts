/**
 * Extrai o ID do spreadsheet a partir de uma URL do Google Sheets.
 *
 * Aceita as formas usuais:
 * - `https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0`
 * - `https://docs.google.com/spreadsheets/d/<ID>` (sem sufixo)
 * - o próprio ID já isolado (string sem barras nem espaços).
 *
 * Retorna `null` quando não reconhece um ID — o chamador trata a URL como
 * não confiável (CLAUDE.md §6).
 */
export const extrairSpreadsheetId = (url: string): string | null => {
  if (typeof url !== 'string') return null;
  const bruto = url.trim();
  if (bruto === '') return null;

  // Forma canônica dentro de uma URL: /spreadsheets/d/<ID>
  const naUrl = bruto.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (naUrl?.[1]) return naUrl[1];

  // Já é um ID isolado (sem esquema, barras ou espaços).
  if (/^[a-zA-Z0-9_-]+$/.test(bruto)) return bruto;

  return null;
};
