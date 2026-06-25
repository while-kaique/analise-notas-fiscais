/**
 * Sessão por **cookie assinado** (HMAC-SHA256 via Web Crypto `crypto.subtle`).
 *
 * O cookie carrega apenas o `id` da sessão + assinatura — os tokens OAuth ficam no
 * `env.DB` (CLAUDE.md §6: segredos fora do cliente). Sem dependência externa.
 */

const NOME_COOKIE = 'nf_sess';
const enc = new TextEncoder();

function hexDeBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Comparação de tempo constante (evita timing attack na verificação da assinatura). */
function igualConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function assinar(valor: string, segredo: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw',
    enc.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', chave, enc.encode(valor));
  return hexDeBuffer(sig);
}

/** Monta o valor assinado `id.assinatura` para gravar no cookie. */
export async function selarSessao(id: string, segredo: string): Promise<string> {
  return `${id}.${await assinar(id, segredo)}`;
}

/** Verifica o valor do cookie e devolve o `id` se a assinatura confere; senão `null`. */
export async function abrirSessao(
  valor: string,
  segredo: string,
): Promise<string | null> {
  const corte = valor.lastIndexOf('.');
  if (corte <= 0) return null;
  const id = valor.slice(0, corte);
  const assinatura = valor.slice(corte + 1);
  const esperada = await assinar(id, segredo);
  return igualConstante(assinatura, esperada) ? id : null;
}

/** Extrai um cookie do header `Cookie`. */
export function lerCookie(header: string | null, nome: string = NOME_COOKIE): string | null {
  if (!header) return null;
  for (const parte of header.split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === nome) return resto.join('=');
  }
  return null;
}

/** Monta o `Set-Cookie` da sessão (HttpOnly, Secure, SameSite=Lax). */
export function cookieSessao(valor: string): string {
  return (
    `${NOME_COOKIE}=${valor}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}`
  );
}

/** Lê + valida a sessão direto do request; `null` se ausente/ inválida. */
export async function sessaoDoRequest(
  req: Request,
  segredo: string,
): Promise<string | null> {
  const bruto = lerCookie(req.headers.get('cookie'), NOME_COOKIE);
  if (!bruto) return null;
  return abrirSessao(bruto, segredo);
}
