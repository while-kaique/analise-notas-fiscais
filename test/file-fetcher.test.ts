import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FileFetcherImpl,
  DownloadError,
  type FetchLike,
} from '../src/download/file-fetcher.js';
import { DestinoBloqueadoError } from '../src/download/ssrf.js';

/** DNS fake que sempre devolve um IP público (não bloqueia por SSRF). */
const dnsPublico = async () => ['93.184.216.34'];

/** `fetch` fake que devolve uma Response fixa e conta as chamadas. */
function fetchFake(resposta: Response): { fn: FetchLike; get chamadas(): number } {
  let chamadas = 0;
  const fn = (async () => {
    chamadas++;
    return resposta;
  }) as unknown as FetchLike;
  return {
    fn,
    get chamadas() {
      return chamadas;
    },
  };
}

function pdfResponse(corpo = '%PDF-1.7\nfake', headers: Record<string, string> = {}) {
  return new Response(Uint8Array.from(corpo, (c) => c.charCodeAt(0)), {
    status: 200,
    headers: { 'content-type': 'application/pdf', ...headers },
  });
}

describe('FileFetcherImpl.baixar', () => {
  it('baixa, calcula SHA-256 e detecta o tipo', async () => {
    const corpo = '%PDF-1.7\nconteudo';
    const f = fetchFake(pdfResponse(corpo));
    const fetcher = new FileFetcherImpl({ fetchImpl: f.fn, resolverDns: dnsPublico });

    const arq = await fetcher.baixar('https://exemplo.com/nota.pdf');

    expect(arq.tipo).toBe('pdf');
    expect(arq.contentType).toBe('application/pdf');
    expect(arq.tamanhoBytes).toBe(corpo.length);
    expect(arq.hash).toBe(
      createHash('sha256').update(arq.bytes).digest('hex'),
    );
    expect(arq.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('usa cache por URL: não rebaixa o mesmo link', async () => {
    const f = fetchFake(pdfResponse());
    const fetcher = new FileFetcherImpl({ fetchImpl: f.fn, resolverDns: dnsPublico });

    await fetcher.baixar('https://exemplo.com/a.pdf');
    await fetcher.baixar('https://exemplo.com/a.pdf');

    expect(f.chamadas).toBe(1);
  });

  it('bloqueia esquema não-http (sem nem resolver DNS)', async () => {
    const f = fetchFake(pdfResponse());
    const fetcher = new FileFetcherImpl({ fetchImpl: f.fn, resolverDns: dnsPublico });

    await expect(fetcher.baixar('file:///etc/passwd')).rejects.toBeInstanceOf(
      DestinoBloqueadoError,
    );
    expect(f.chamadas).toBe(0);
  });

  it('bloqueia quando o host resolve para IP interno (SSRF)', async () => {
    const f = fetchFake(pdfResponse());
    const fetcher = new FileFetcherImpl({
      fetchImpl: f.fn,
      resolverDns: async () => ['169.254.169.254'],
    });

    await expect(
      fetcher.baixar('https://metadata.interno/nota.pdf'),
    ).rejects.toBeInstanceOf(DestinoBloqueadoError);
    expect(f.chamadas).toBe(0);
  });

  it('rejeita por Content-Length acima do limite', async () => {
    const f = fetchFake(pdfResponse('%PDF-1.7', { 'content-length': '999999' }));
    const fetcher = new FileFetcherImpl({
      fetchImpl: f.fn,
      resolverDns: dnsPublico,
      opcoes: { maxBytes: 10 },
    });

    await expect(fetcher.baixar('https://exemplo.com/grande.pdf')).rejects.toThrow(
      DownloadError,
    );
  });

  it('rejeita por stream acima do limite (sem Content-Length)', async () => {
    const corpo = '%PDF-1.7 abcdefghijklmnopqrstuvwxyz';
    const f = fetchFake(pdfResponse(corpo)); // pdfResponse não envia content-length
    const fetcher = new FileFetcherImpl({
      fetchImpl: f.fn,
      resolverDns: dnsPublico,
      opcoes: { maxBytes: 5 },
    });

    await expect(fetcher.baixar('https://exemplo.com/grande.pdf')).rejects.toThrow(
      DownloadError,
    );
  });

  it('mapeia HTTP de erro para DownloadError acionável', async () => {
    const f = fetchFake(new Response('not found', { status: 404, statusText: 'Not Found' }));
    const fetcher = new FileFetcherImpl({ fetchImpl: f.fn, resolverDns: dnsPublico });

    await expect(fetcher.baixar('https://exemplo.com/morto.pdf')).rejects.toThrow(
      /HTTP 404/,
    );
  });

  it('mapeia AbortError (timeout) para DownloadError', async () => {
    const abortar = (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as FetchLike;
    const fetcher = new FileFetcherImpl({ fetchImpl: abortar, resolverDns: dnsPublico });

    await expect(fetcher.baixar('https://exemplo.com/lento.pdf')).rejects.toThrow(
      /Timeout/,
    );
  });
});
