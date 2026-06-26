/**
 * SHA-256 (hex) via **Web Crypto** (`crypto.subtle`) — sem dependência externa e
 * disponível tanto no Node 20+ quanto no Cloudflare Workers (mesma abordagem do
 * `FileFetcherWorkers` da F4). Usado para a chave do cache de extração (spec §7:
 * "não re-OCR/re-IA do mesmo arquivo").
 */

/** Calcula o SHA-256 (hexadecimal minúsculo) de bytes ou de uma string (UTF-8). */
export async function sha256Hex(dados: Uint8Array | string): Promise<string> {
  const bytes = typeof dados === 'string' ? new TextEncoder().encode(dados) : dados;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
