import { describe, it, expect, vi } from 'vitest';
import { FileFetcherWorkers } from '../src/download/file-fetcher-workers.js';
import type { FetchLike } from '../src/download/index.js';

function fakeFetch(body: string, headers: Record<string, string>): FetchLike {
  return vi.fn(async () => new Response(body, { status: 200, headers })) as unknown as FetchLike;
}

describe('FileFetcherWorkers', () => {
  it('baixa um PDF público: bytes, hash sha256, tipo e redirect:error', async () => {
    const fetchImpl = fakeFetch('%PDF-1.4 conteúdo', { 'content-type': 'application/pdf' });
    const fetcher = new FileFetcherWorkers({}, fetchImpl);

    const arq = await fetcher.baixar('https://exemplo.com/nota.pdf');
    expect(arq.tipo).toBe('pdf');
    expect(arq.tamanhoBytes).toBeGreaterThan(0);
    expect(arq.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(arq.contentType).toBe('application/pdf');

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(init.redirect).toBe('error');
  });

  it('usa o cache: não rebaixa a mesma URL', async () => {
    const fetchImpl = fakeFetch('%PDF-1.4', { 'content-type': 'application/pdf' });
    const fetcher = new FileFetcherWorkers({}, fetchImpl);
    await fetcher.baixar('https://exemplo.com/a.pdf');
    await fetcher.baixar('https://exemplo.com/a.pdf');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('bloqueia IP interno literal (SSRF) sem chamar fetch', async () => {
    const fetchImpl = fakeFetch('x', {});
    const fetcher = new FileFetcherWorkers({}, fetchImpl);
    await expect(fetcher.baixar('http://127.0.0.1/meta')).rejects.toThrow(/SSRF|interno/i);
    await expect(fetcher.baixar('http://169.254.169.254/latest')).rejects.toThrow(/SSRF|interno/i);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('bloqueia hostnames internos (localhost/.internal)', async () => {
    const fetcher = new FileFetcherWorkers({}, fakeFetch('x', {}));
    await expect(fetcher.baixar('http://localhost/x')).rejects.toThrow(/SSRF|interno/i);
    await expect(fetcher.baixar('http://metadata.google.internal/x')).rejects.toThrow(/SSRF|interno/i);
  });

  it('rejeita esquema não http/https', async () => {
    const fetcher = new FileFetcherWorkers({}, fakeFetch('x', {}));
    await expect(fetcher.baixar('ftp://exemplo.com/x')).rejects.toThrow(/SSRF|esquema/i);
  });

  it('corta cedo quando o Content-Length excede maxBytes', async () => {
    const fetchImpl = fakeFetch('%PDF-1.4', {
      'content-type': 'application/pdf',
      'content-length': '999999',
    });
    const fetcher = new FileFetcherWorkers({ maxBytes: 1000 }, fetchImpl);
    await expect(fetcher.baixar('https://exemplo.com/grande.pdf')).rejects.toThrow(/excede/i);
  });
});
