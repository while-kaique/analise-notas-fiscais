import { describe, it, expect } from 'vitest';
import { extrairSpreadsheetId } from '../src/sheets/spreadsheet-id.js';

describe('extrairSpreadsheetId', () => {
  it('extrai o ID de uma URL completa de edição', () => {
    const url =
      'https://docs.google.com/spreadsheets/d/1AbC_dEf-123XYZ/edit#gid=0';
    expect(extrairSpreadsheetId(url)).toBe('1AbC_dEf-123XYZ');
  });

  it('extrai o ID de uma URL sem sufixo', () => {
    expect(
      extrairSpreadsheetId('https://docs.google.com/spreadsheets/d/abc123'),
    ).toBe('abc123');
  });

  it('aceita o ID já isolado', () => {
    expect(extrairSpreadsheetId('1AbC_dEf-123')).toBe('1AbC_dEf-123');
  });

  it('ignora espaços ao redor', () => {
    expect(extrairSpreadsheetId('  abc123  ')).toBe('abc123');
  });

  it('retorna null para URL que não é Google Sheets', () => {
    expect(extrairSpreadsheetId('https://example.com/foo/bar')).toBeNull();
  });

  it('retorna null para entrada vazia', () => {
    expect(extrairSpreadsheetId('')).toBeNull();
    expect(extrairSpreadsheetId('   ')).toBeNull();
  });
});
