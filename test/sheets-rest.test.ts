import { describe, it, expect, vi, afterEach } from 'vitest';
import { SheetsRest } from '../src/api/google.js';
import { COLUNAS } from '../src/types/index.js';
import type { LinhaResultado } from '../src/types/index.js';

function resp(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SheetsRest.lerLinhas', () => {
  it('resolve a primeira aba e mapeia linhas por cabeçalho', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('fields=sheets.properties.title')) {
        return resp({ sheets: [{ properties: { title: 'Notas' } }] });
      }
      // values get
      return resp({
        values: [
          ['Link', 'Status', 'Observação'],
          ['http://exemplo/n1.pdf', 'PENDENTE', 'x'],
          ['', '', ''], // linha vazia → ignorada
          ['http://exemplo/n2.pdf', 'CONCLUIDO', 'y'],
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new SheetsRest(async () => 'token-abc');
    const leitura = await client.lerLinhas('planilha-1');

    expect(leitura.total).toBe(2);
    expect(leitura.linhas[0]).toEqual({
      numeroLinha: 2,
      linkArquivo: 'http://exemplo/n1.pdf',
      statusAtual: 'PENDENTE',
    });
    expect(leitura.linhas[1]).toEqual({
      numeroLinha: 4,
      linkArquivo: 'http://exemplo/n2.pdf',
      statusAtual: 'CONCLUIDO',
    });
    // Manda o Bearer token nos headers.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer token-abc',
    );
  });
});

describe('SheetsRest.escreverResultados', () => {
  it('escreve em lote via values:batchUpdate quando as colunas já existem', async () => {
    const headerCompleto = Object.values(COLUNAS); // todas as colunas de resultado
    let corpoBatch: unknown = null;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('fields=sheets.properties.title')) {
        return resp({ sheets: [{ properties: { title: 'Notas' } }] });
      }
      if (url.includes('/values/') && (!init || init.method === undefined)) {
        // garantirColunas lê a linha 1
        return resp({ values: [headerCompleto] });
      }
      if (url.includes(':batchUpdate')) {
        corpoBatch = JSON.parse(String(init?.body));
        return resp({});
      }
      throw new Error('URL inesperada: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new SheetsRest(async () => 'tok');
    const resultados: LinhaResultado[] = [
      {
        numeroLinha: 2,
        status: 'CONCLUIDO',
        nota: {
          cnpjEmitente: '12345678000199',
          dataEmissao: '2026-01-10',
          valorTotalCentavos: 123456,
        },
        processadoEm: '2026-06-25T00:00:00.000Z',
      },
    ];
    await client.escreverResultados('planilha-1', resultados);

    expect(corpoBatch).not.toBeNull();
    const corpo = corpoBatch as { valueInputOption: string; data: { range: string; values: unknown[][] }[] };
    expect(corpo.valueInputOption).toBe('RAW');
    // 6 colunas de resultado → 6 células para a linha 2.
    expect(corpo.data).toHaveLength(6);
    // Valor é escrito em reais (centavos/100).
    const celulaValor = corpo.data.find((d) => d.values[0]?.[0] === 1234.56);
    expect(celulaValor).toBeDefined();
  });

  it('não faz nada com lista vazia', async () => {
    const fetchMock = vi.fn(async () => resp({}));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SheetsRest(async () => 'tok');
    await client.escreverResultados('p', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
