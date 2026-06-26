import { describe, it, expect } from 'vitest';
import type { ArquivoBaixado } from '../src/types/arquivo.js';
import type { BaixadorNf } from '../src/conferencia/contratos.js';
import { BaixadorDrive } from '../src/conferencia/drive/baixador-drive.js';
import type { CredencialServico } from '../src/conferencia/drive/credencial.js';

const credFake: CredencialServico = { obterAccessToken: () => Promise.resolve('tok-1') };
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n');
const ID = '1AbC_def-GHIjklmnop';

function fakeFetch(resp: Response) {
  const chamadas: { url: string; auth: string | undefined }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({ url: String(url), auth: headers['authorization'] });
    return resp;
  }) as unknown as typeof fetch;
  return { fn, chamadas };
}

describe('BaixadorDrive', () => {
  it('baixa do Drive com alt=media + Bearer e devolve ArquivoBaixado', async () => {
    const { fn, chamadas } = fakeFetch(
      new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    const baixador = new BaixadorDrive({ credencial: credFake, fetchImpl: fn });

    const arq = await baixador.baixar(`https://drive.google.com/file/d/${ID}/view`);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toContain(`/drive/v3/files/${ID}`);
    expect(chamadas[0]?.url).toContain('alt=media');
    expect(chamadas[0]?.auth).toBe('Bearer tok-1');
    expect(arq.tipo).toBe('pdf');
    expect(arq.tamanhoBytes).toBe(PDF.byteLength);
    expect(arq.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(arq.contentType).toBe('application/pdf');
  });

  it('usa o fallback quando o link não é do Drive', async () => {
    const { fn, chamadas } = fakeFetch(new Response('x'));
    let usouFallback = '';
    const fallback: BaixadorNf = {
      baixar: (link) => {
        usouFallback = link;
        return Promise.resolve({
          bytes: new Uint8Array([1]),
          hash: 'h',
          tipo: 'pdf',
          tamanhoBytes: 1,
        } satisfies ArquivoBaixado);
      },
    };
    const baixador = new BaixadorDrive({ credencial: credFake, fetchImpl: fn, fallback });

    const arq = await baixador.baixar('https://example.com/nota.pdf');
    expect(usouFallback).toBe('https://example.com/nota.pdf');
    expect(arq.tamanhoBytes).toBe(1);
    expect(chamadas).toHaveLength(0); // não chamou o Drive
  });

  it('lança quando o link não é do Drive e não há fallback', async () => {
    const { fn } = fakeFetch(new Response('x'));
    const baixador = new BaixadorDrive({ credencial: credFake, fetchImpl: fn });
    await expect(baixador.baixar('https://example.com/nota.pdf')).rejects.toThrow(
      /sem fallback/,
    );
  });

  it('erro acionável quando o Drive responde != 2xx', async () => {
    const { fn } = fakeFetch(new Response('Not Found', { status: 404 }));
    const baixador = new BaixadorDrive({ credencial: credFake, fetchImpl: fn });
    await expect(
      baixador.baixar(`https://drive.google.com/open?id=${ID}`),
    ).rejects.toThrow(/404/);
  });

  it('respeita o limite de tamanho (maxBytes)', async () => {
    const { fn } = fakeFetch(
      new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    const baixador = new BaixadorDrive({ credencial: credFake, fetchImpl: fn, maxBytes: 4 });
    await expect(
      baixador.baixar(`https://drive.google.com/open?id=${ID}`),
    ).rejects.toThrow(/limite de 4 bytes/);
  });
});
