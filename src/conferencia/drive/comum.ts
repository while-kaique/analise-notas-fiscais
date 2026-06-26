/**
 * Utilidades compartilhadas do download via Drive (C4): tipo de `fetch` injetável,
 * hash SHA-256 (Web Crypto), leitura de corpo com limite de tamanho e erro acionável.
 * Workers-native — só `fetch` + `crypto.subtle`, sem `node:*` (CLAUDE.md §11).
 */

/** Assinatura de `fetch` — injetável nos testes. */
export type FetchLike = typeof fetch;

/** Erro de download/credencial com mensagem acionável (sem logar conteúdo de NF). */
export class ErroDrive extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroDrive';
  }
}

/** SHA-256 do conteúdo em hexadecimal (cache por hash — CLAUDE.md §5). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lê o corpo da resposta respeitando `maxBytes` — corta cedo por `Content-Length`
 * **e** durante o stream (a origem pode mentir/omitir o header). Espelha a lógica do
 * `FileFetcherWorkers` (F4/FUND), mas isolada para a C4 não acoplar ao módulo `download`.
 */
export async function lerCorpoLimitado(
  resposta: Response,
  maxBytes: number,
  contexto: string,
): Promise<Uint8Array> {
  const declarado = Number(resposta.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > maxBytes) {
    throw new ErroDrive(
      `${contexto} excede o limite de ${maxBytes} bytes (Content-Length=${declarado}).`,
    );
  }

  const corpo = resposta.body;
  if (!corpo) {
    const buffer = new Uint8Array(await resposta.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new ErroDrive(`${contexto} excede o limite de ${maxBytes} bytes.`);
    }
    return buffer;
  }

  const leitor = corpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ErroDrive(`${contexto} excede o limite de ${maxBytes} bytes.`);
      }
      partes.push(value);
    }
  } finally {
    leitor.releaseLock();
  }

  const resultado = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) {
    resultado.set(parte, offset);
    offset += parte.byteLength;
  }
  return resultado;
}
