import { describe, it, expect } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { SheetsClientImpl } from '../src/sheets/sheets-client.js';
import type { LinhaResultado } from '../src/types/index.js';

/**
 * Fake mínimo da Google Sheets API v4 — registra as chamadas e devolve valores
 * controlados. Evita rede; exercita a lógica de leitura/escrita do SheetsClient.
 */
function fakeSheets(opts: {
  abaTitulo?: string;
  valoresPorRange: Record<string, unknown[][]>;
}) {
  const chamadas = {
    updates: [] as Array<{ range: string; values: unknown[][] }>,
    batch: [] as sheets_v4.Schema$BatchUpdateValuesRequest[],
  };

  const api = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [{ properties: { title: opts.abaTitulo ?? 'Página1' } }],
        },
      }),
      values: {
        get: async ({ range }: { range: string }) => ({
          data: { values: opts.valoresPorRange[range] ?? [] },
        }),
        update: async ({
          range,
          requestBody,
        }: {
          range: string;
          requestBody: { values: unknown[][] };
        }) => {
          chamadas.updates.push({ range, values: requestBody.values });
          return { data: {} };
        },
        batchUpdate: async ({
          requestBody,
        }: {
          requestBody: sheets_v4.Schema$BatchUpdateValuesRequest;
        }) => {
          chamadas.batch.push(requestBody);
          return { data: {} };
        },
      },
    },
  } as unknown as sheets_v4.Sheets;

  return { api, chamadas };
}

describe('SheetsClientImpl.lerLinhas', () => {
  it('lê linhas, mapeia colunas por cabeçalho e detecta link + status', async () => {
    const { api } = fakeSheets({
      valoresPorRange: {
        "'Página1'": [
          ['Link', 'Status', 'Valor'],
          ['http://x/1.pdf', 'CONCLUIDO', ''],
          ['http://x/2.pdf', '', ''],
          ['', '', ''], // linha vazia: ignorada
        ],
      },
    });
    const client = new SheetsClientImpl(api);
    const leitura = await client.lerLinhas('sid');

    expect(leitura.mapa).toEqual({ Link: 0, Status: 1, Valor: 2 });
    expect(leitura.total).toBe(2);
    expect(leitura.linhas[0]).toEqual({
      numeroLinha: 2,
      linkArquivo: 'http://x/1.pdf',
      statusAtual: 'CONCLUIDO',
    });
    // Status vazio → statusAtual ausente (não undefined explícito).
    expect(leitura.linhas[1]).toEqual({
      numeroLinha: 3,
      linkArquivo: 'http://x/2.pdf',
    });
  });
});

describe('SheetsClientImpl.garantirColunas', () => {
  it('cria apenas as colunas que faltam, anexando ao final', async () => {
    const { api, chamadas } = fakeSheets({
      valoresPorRange: { "'Página1'!1:1": [['Link', 'Status']] },
    });
    const client = new SheetsClientImpl(api);
    const mapa = await client.garantirColunas('sid', [
      'Status',
      'Valor',
      'Erro',
    ]);

    // 'Status' já existia; 'Valor' e 'Erro' foram anexados em C, D.
    expect(mapa).toEqual({ Link: 0, Status: 1, Valor: 2, Erro: 3 });
    expect(chamadas.updates).toHaveLength(1);
    expect(chamadas.updates[0]).toEqual({
      range: "'Página1'!C1",
      values: [['Valor', 'Erro']],
    });
  });

  it('não escreve nada quando todas as colunas já existem', async () => {
    const { api, chamadas } = fakeSheets({
      valoresPorRange: { "'Página1'!1:1": [['Status', 'Valor']] },
    });
    const client = new SheetsClientImpl(api);
    await client.garantirColunas('sid', ['Status']);
    expect(chamadas.updates).toHaveLength(0);
  });
});

describe('SheetsClientImpl.escreverResultados', () => {
  it('escreve em lote (batchUpdate) só nas colunas de resultado', async () => {
    const { api, chamadas } = fakeSheets({
      valoresPorRange: {
        "'Página1'!1:1": [
          [
            'Link',
            'Status',
            'CNPJ Emitente',
            'Data Emissão',
            'Valor',
            'Erro',
            'Processado em',
          ],
        ],
      },
    });
    const client = new SheetsClientImpl(api);
    const resultados: LinhaResultado[] = [
      {
        numeroLinha: 2,
        status: 'CONCLUIDO',
        nota: {
          cnpjEmitente: '12345678000199',
          dataEmissao: '2026-01-15',
          valorTotalCentavos: 50000,
        },
        processadoEm: '2026-06-25T00:00:00.000Z',
      },
    ];
    await client.escreverResultados('sid', resultados);

    expect(chamadas.updates).toHaveLength(0); // colunas já existem
    expect(chamadas.batch).toHaveLength(1);
    const data = chamadas.batch[0]!.data!;
    const porRange = Object.fromEntries(
      data.map((d) => [d.range, d.values?.[0]?.[0]]),
    );
    expect(porRange["'Página1'!B2"]).toBe('CONCLUIDO');
    expect(porRange["'Página1'!E2"]).toBe(500); // 50000 centavos → 500 reais
    expect(porRange["'Página1'!A2"]).toBeUndefined(); // não toca no link
  });

  it('não chama a API quando não há resultados', async () => {
    const { api, chamadas } = fakeSheets({ valoresPorRange: {} });
    const client = new SheetsClientImpl(api);
    await client.escreverResultados('sid', []);
    expect(chamadas.batch).toHaveLength(0);
  });
});
