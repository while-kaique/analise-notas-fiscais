/**
 * Proteção contra SSRF para o download de arquivos (CLAUDE.md §6).
 *
 * Os links de PDF/XML vêm da planilha do usuário — **não são confiáveis**.
 * Antes de baixar precisamos garantir que o destino não é interno: apenas
 * `http`/`https` e nunca um IP de loopback, privado, link-local, etc. Assim
 * impedimos que um link malicioso faça o servidor acessar serviços internos
 * (metadados de nuvem, `localhost`, rede privada).
 *
 * As funções aqui são **puras** (sem I/O) para serem testáveis isoladamente.
 * A resolução de DNS (que tem I/O) fica no `FileFetcher`, que chama
 * {@link ipBloqueado} com cada IP resolvido.
 */

/** Esquemas de URL permitidos. */
export const ESQUEMAS_PERMITIDOS: readonly string[] = ['http:', 'https:'];

/** Erro de destino bloqueado pela guarda de SSRF (mensagem acionável). */
export class DestinoBloqueadoError extends Error {
  constructor(motivo: string) {
    super(`Destino bloqueado pela proteção de SSRF: ${motivo}`);
    this.name = 'DestinoBloqueadoError';
  }
}

/**
 * Valida e normaliza a URL: precisa ser absoluta e usar http/https.
 * Lança {@link DestinoBloqueadoError} caso contrário.
 */
export function validarUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DestinoBloqueadoError(`URL inválida: "${url}".`);
  }
  if (!ESQUEMAS_PERMITIDOS.includes(parsed.protocol)) {
    throw new DestinoBloqueadoError(
      `esquema "${parsed.protocol}" não permitido (use http/https).`,
    );
  }
  return parsed;
}

/** Tenta interpretar `s` como um IPv4 em quatro octetos decimais. */
function parseIpv4(s: string): readonly number[] | null {
  const partes = s.split('.');
  if (partes.length !== 4) return null;
  const octetos: number[] = [];
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null;
    const n = Number(parte);
    if (n > 255) return null;
    octetos.push(n);
  }
  return octetos;
}

/** Classifica um IPv4 (em octetos) como bloqueado (privado/interno/reservado). */
function ipv4Bloqueado(o: readonly number[]): boolean {
  const [a, b] = o as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 privado
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadados de nuvem)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 privado
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 privado
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reservado + 255.255.255.255
  return false;
}

/** Normaliza um IPv6 textual (sem zona) para a lista de grupos de 16 bits. */
function parseIpv6(s: string): readonly number[] | null {
  let texto = s;
  // Remove zona de escopo (ex.: fe80::1%eth0).
  const pct = texto.indexOf('%');
  if (pct !== -1) texto = texto.slice(0, pct);
  if (!texto.includes(':')) return null;

  const ladoIpv4 = texto.includes('.');
  const partes = texto.split('::');
  if (partes.length > 2) return null;

  const parseGrupos = (str: string): number[] | null => {
    if (str === '') return [];
    const grupos: number[] = [];
    const itens = str.split(':');
    for (let i = 0; i < itens.length; i++) {
      const item = itens[i] as string;
      const ultimo = i === itens.length - 1;
      if (ultimo && item.includes('.')) {
        // IPv4 embutido (ex.: ::ffff:127.0.0.1) → dois grupos de 16 bits.
        const v4 = parseIpv4(item);
        if (!v4) return null;
        grupos.push(((v4[0] as number) << 8) | (v4[1] as number));
        grupos.push(((v4[2] as number) << 8) | (v4[3] as number));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(item)) return null;
      grupos.push(parseInt(item, 16));
    }
    return grupos;
  };

  const cabeca = parseGrupos(partes[0] as string);
  const cauda = partes.length === 2 ? parseGrupos(partes[1] as string) : null;
  if (cabeca === null) return null;

  let grupos: number[];
  if (partes.length === 2) {
    if (cauda === null) return null;
    const faltam = 8 - (cabeca.length + cauda.length);
    if (faltam < 0) return null;
    grupos = [...cabeca, ...Array<number>(faltam).fill(0), ...cauda];
  } else {
    grupos = cabeca;
  }
  // Comprimento esperado: 8 grupos (o IPv4 embutido já virou 2 grupos).
  const esperado = 8;
  if (grupos.length !== esperado) return null;
  void ladoIpv4;
  return grupos;
}

/** Classifica um IPv6 (em grupos de 16 bits) como bloqueado. */
function ipv6Bloqueado(g: readonly number[]): boolean {
  const todosZero = g.every((x) => x === 0);
  if (todosZero) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
  const g0 = g[0] as number;
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA (privado)
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv4-mapped (::ffff:a.b.c.d) e IPv4-compatible → reavalia o IPv4 embutido.
  const prefixoZero = g.slice(0, 5).every((x) => x === 0);
  if (prefixoZero && (g[5] === 0xffff || g[5] === 0)) {
    const a = ((g[6] as number) >> 8) & 0xff;
    const b = (g[6] as number) & 0xff;
    const c = ((g[7] as number) >> 8) & 0xff;
    const d = (g[7] as number) & 0xff;
    return ipv4Bloqueado([a, b, c, d]);
  }
  return false;
}

/**
 * Indica se um IP (IPv4 ou IPv6, em texto) deve ser bloqueado por ser interno,
 * privado, loopback, link-local, multicast ou reservado. Um IP que não casa
 * com nenhuma das faixas é considerado público (liberado).
 */
export function ipBloqueado(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return ipv4Bloqueado(v4);
  const v6 = parseIpv6(ip);
  if (v6) return ipv6Bloqueado(v6);
  // Não conseguimos interpretar o IP → por segurança, bloqueia.
  return true;
}
