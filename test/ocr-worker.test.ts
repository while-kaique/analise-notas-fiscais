import { describe, it, expect, vi } from 'vitest';
import { criarLeitorPdf } from '../src/extract/index.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

function respostaOk(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('criarLeitorPdf (cliente do OCR Worker)', () => {
  it('faz POST application/pdf + Bearer e devolve json.text', async () => {
    const fetchImpl = vi.fn(async () => respostaOk({ text: 'TEXTO DA NOTA' }));
    const ler = criarLeitorPdf({
      url: 'https://ocr.example.workers.dev/',
      token: 'tok-abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const texto = await ler(PDF);
    expect(texto).toBe('TEXTO DA NOTA');

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://ocr.example.workers.dev/');
    expect(init!.method).toBe('POST');
    const headers = init!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers.Authorization).toBe('Bearer tok-abc');
    expect(init!.body).toBeInstanceOf(Uint8Array);
  });

  it('aceita também o campo `content` como fallback', async () => {
    const fetchImpl = vi.fn(async () => respostaOk({ content: 'VIA CONTENT' }));
    const ler = criarLeitorPdf({
      url: 'u',
      token: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await ler(PDF)).toBe('VIA CONTENT');
  });

  it('lança com status e detalhe quando o worker responde != 2xx', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('quota exceeded', { status: 429 }),
    );
    const ler = criarLeitorPdf({
      url: 'u',
      token: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(ler(PDF)).rejects.toThrow(/429.*quota exceeded/);
  });

  it('lança mensagem acionável quando url/token faltam', async () => {
    const ler = criarLeitorPdf({ url: '', token: '' });
    await expect(ler(PDF)).rejects.toThrow(/OCR_WORKER_URL e OCR_WORKER_TOKEN/);
  });
});
