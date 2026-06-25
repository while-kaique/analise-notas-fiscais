import { describe, it, expect } from 'vitest';
import type { DependenciasPipeline } from '../src/pipeline/index.js';
import { processarLinha } from '../src/pipeline/index.js';
import {
  ExtractorFake,
  FetcherFake,
  SheetsFake,
  extraidaOk,
} from './helpers/fakes.js';

function deps(
  fetcher: FetcherFake,
  extractor: ExtractorFake,
): DependenciasPipeline {
  return { sheets: new SheetsFake([]), fetcher, extractor };
}

describe('processarLinha', () => {
  it('baixa, extrai e conclui com a nota normalizada', async () => {
    const fetcher = new FetcherFake();
    const extractor = new ExtractorFake(() => extraidaOk());

    const r = await processarLinha(
      { numeroLinha: 2, linkArquivo: 'https://x/nota.pdf' },
      deps(fetcher, extractor),
    );

    expect(r.status).toBe('CONCLUIDO');
    expect(r.numeroLinha).toBe(2);
    expect(r.nota?.cnpjEmitente).toBe('11222333000181');
    expect(r.fonte).toBe('XML');
    expect(r.confianca).toBe(0.99);
    expect(r.erro).toBeUndefined();
    expect(fetcher.baixadas).toEqual(['https://x/nota.pdf']);
  });

  it('não lança quando o download falha: vira ERRO acionável (falha isolada)', async () => {
    const fetcher = new FetcherFake(new Set(['https://x/morto.pdf']));
    const extractor = new ExtractorFake(() => extraidaOk());

    const r = await processarLinha(
      { numeroLinha: 5, linkArquivo: 'https://x/morto.pdf' },
      deps(fetcher, extractor),
    );

    expect(r.status).toBe('ERRO');
    expect(r.erro).toContain('linha 5');
    expect(r.erro).toContain('link morto');
    expect(extractor.chamadas).toBe(0);
  });

  it('marca ERRO quando a extração lança', async () => {
    const fetcher = new FetcherFake();
    const extractor = new ExtractorFake(() => {
      throw new Error('PDF ilegível');
    });

    const r = await processarLinha(
      { numeroLinha: 3, linkArquivo: 'https://x/a.pdf' },
      deps(fetcher, extractor),
    );

    expect(r.status).toBe('ERRO');
    expect(r.erro).toContain('PDF ilegível');
  });

  it('rejeita nota estruturalmente inválida (CNPJ fora do padrão)', async () => {
    const fetcher = new FetcherFake();
    const extractor = new ExtractorFake(() =>
      extraidaOk({ cnpjEmitente: '123' }),
    );

    const r = await processarLinha(
      { numeroLinha: 7, linkArquivo: 'https://x/a.pdf' },
      deps(fetcher, extractor),
    );

    expect(r.status).toBe('ERRO');
    expect(r.erro).toContain('CNPJ');
    // preserva proveniência mesmo ao recusar
    expect(r.fonte).toBe('XML');
  });
});
