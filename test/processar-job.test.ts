import { describe, it, expect } from 'vitest';
import type { Job, LinhaResultado } from '../src/index.js';
import { COLUNAS } from '../src/index.js';
import type { DependenciasPipeline } from '../src/pipeline/index.js';
import { processarJob } from '../src/pipeline/index.js';
import {
  ExtractorFake,
  FetcherFake,
  SheetsFake,
  extraidaOk,
} from './helpers/fakes.js';

function jobFake(): Job {
  return {
    id: 'job-1',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit',
    spreadsheetId: 'abc',
    donoId: 'user-1',
    criadoEm: '2026-06-25T12:00:00.000Z',
    status: 'CRIADO',
  };
}

describe('processarJob', () => {
  it('garante as colunas de resultado pelo cabeçalho canônico', async () => {
    const sheets = new SheetsFake([
      { numeroLinha: 2, linkArquivo: 'https://x/1.pdf' },
    ]);
    const deps: DependenciasPipeline = {
      sheets,
      fetcher: new FetcherFake(),
      extractor: new ExtractorFake(() => extraidaOk()),
    };

    await processarJob(jobFake(), deps);

    expect(sheets.garantirChamadaCom).toEqual(Object.values(COLUNAS));
  });

  it('marca PROCESSANDO antes (em lote) e grava os resultados finais depois', async () => {
    const sheets = new SheetsFake([
      { numeroLinha: 2, linkArquivo: 'https://x/1.pdf' },
      { numeroLinha: 3, linkArquivo: 'https://x/2.pdf' },
    ]);
    const deps: DependenciasPipeline = {
      sheets,
      fetcher: new FetcherFake(),
      extractor: new ExtractorFake(() => extraidaOk()),
    };

    await processarJob(jobFake(), deps);

    // dois lotes: PROCESSANDO (antes) e o resultado final.
    expect(sheets.lotes.length).toBe(2);
    expect(sheets.lotes[0]!.every((r) => r.status === 'PROCESSANDO')).toBe(true);
    expect(sheets.lotes[1]!.every((r) => r.status === 'CONCLUIDO')).toBe(true);
  });

  it('idempotência: pula linhas já CONCLUIDO (não rebaixa nem reextrai)', async () => {
    const sheets = new SheetsFake([
      { numeroLinha: 2, linkArquivo: 'https://x/1.pdf', statusAtual: 'CONCLUIDO' },
      { numeroLinha: 3, linkArquivo: 'https://x/2.pdf', statusAtual: 'PENDENTE' },
    ]);
    const fetcher = new FetcherFake();
    const extractor = new ExtractorFake(() => extraidaOk());
    const deps: DependenciasPipeline = { sheets, fetcher, extractor };

    await processarJob(jobFake(), deps);

    expect(fetcher.baixadas).toEqual(['https://x/2.pdf']);
    expect(extractor.chamadas).toBe(1);
    const finais = sheets.lotes.at(-1)!;
    expect(finais.map((r) => r.numeroLinha)).toEqual([3]);
  });

  it('não faz escritas quando tudo já está CONCLUIDO', async () => {
    const sheets = new SheetsFake([
      { numeroLinha: 2, linkArquivo: 'https://x/1.pdf', statusAtual: 'CONCLUIDO' },
    ]);
    const deps: DependenciasPipeline = {
      sheets,
      fetcher: new FetcherFake(),
      extractor: new ExtractorFake(() => extraidaOk()),
    };

    await processarJob(jobFake(), deps);

    // só a marcação de PROCESSANDO seria escrita se houvesse algo a processar.
    expect(sheets.lotes.length).toBe(0);
  });

  it('falha isolada: o erro de uma linha não derruba as demais', async () => {
    const sheets = new SheetsFake([
      { numeroLinha: 2, linkArquivo: 'https://x/ok.pdf' },
      { numeroLinha: 3, linkArquivo: 'https://x/morto.pdf' },
      { numeroLinha: 4, linkArquivo: 'https://x/ok2.pdf' },
    ]);
    const deps: DependenciasPipeline = {
      sheets,
      fetcher: new FetcherFake(new Set(['https://x/morto.pdf'])),
      extractor: new ExtractorFake(() => extraidaOk()),
    };

    await processarJob(jobFake(), deps);

    const finais = sheets.lotes.at(-1)!;
    const porLinha = new Map(finais.map((r) => [r.numeroLinha, r]));
    expect(porLinha.get(2)!.status).toBe('CONCLUIDO');
    expect(porLinha.get(3)!.status).toBe('ERRO');
    expect(porLinha.get(4)!.status).toBe('CONCLUIDO');
  });

  it('reporta progresso por linha (status inicial e final)', async () => {
    const sheets = new SheetsFake([
      { numeroLinha: 2, linkArquivo: 'https://x/1.pdf' },
    ]);
    const deps: DependenciasPipeline = {
      sheets,
      fetcher: new FetcherFake(),
      extractor: new ExtractorFake(() => extraidaOk()),
    };
    const eventos: LinhaResultado[] = [];

    await processarJob(jobFake(), deps, {
      onProgresso: (r) => eventos.push(r),
    });

    expect(eventos.map((e) => e.status)).toEqual(['PROCESSANDO', 'CONCLUIDO']);
  });
});
