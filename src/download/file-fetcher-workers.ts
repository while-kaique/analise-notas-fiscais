/**
 * `FileFetcher` **Workers-native** (runtime GoDeploy / Cloudflare workerd).
 *
 * Usa só `fetch` + Web Crypto — sem `node:dns`/`node:crypto`, que não rodam no
 * edge (por isso o `FileFetcherImpl` da F4, baseado neles, não serve aqui).
 *
 * SSRF (CLAUDE.md §6) — no workerd o app **não resolve DNS**, então não dá para
 * pré-resolver o host e checar todos os IPs como faz a F4. Mitigação no v1:
 *  - só `http`/`https` (`validarUrl`);
 *  - host que é **IP literal** → `ipBloqueado` (barra loopback/privado/link-local/etc.);
 *  - hostnames internos óbvios (`localhost`, `*.local`, `*.internal`, metadados) são barrados por nome;
 *  - demais hostnames contam com o **isolamento de rede do edge** (o `fetch` do Worker
 *    não alcança rede privada/metadados) + `redirect: 'error'` (um redirect burlaria a checagem).
 *  Pinagem de IP por nome fica para depois (mesma limitação registrada na F4).
 */
import type { ArquivoBaixado } from '../types/index.js';
import type { FileFetcher, OpcoesDownload } from './index.js';
import { DownloadError, OPCOES_PADRAO, type FetchLike } from './file-fetcher.js';
import { DestinoBloqueadoError, ipBloqueado, validarUrl } from './ssrf.js';
import { detectarTipo } from './tipo-arquivo.js';

/** Remove colchetes de um host IPv6 literal (`[::1]` → `::1`). */
function semColchetes(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** `true` se o host é um IP literal (IPv4 pontilhado ou IPv6 com `:`). */
function ehIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** Hostnames internos barrados por nome (não há DNS para resolvê-los no edge). */
function hostnameInternoBloqueado(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h === 'metadata.google.internal'
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class FileFetcherWorkers implements FileFetcher {
  readonly #fetchImpl: FetchLike;
  readonly #opcoes: OpcoesDownload;
  readonly #cache = new Map<string, ArquivoBaixado>();

  constructor(opcoes?: Partial<OpcoesDownload>, fetchImpl: FetchLike = fetch) {
    this.#fetchImpl = fetchImpl;
    this.#opcoes = { ...OPCOES_PADRAO, ...opcoes };
  }

  async baixar(url: string): Promise<ArquivoBaixado> {
    const emCache = this.#cache.get(url);
    if (emCache) return emCache;

    const parsed = validarUrl(url);
    this.#garantirDestinoSeguro(semColchetes(parsed.hostname));

    const arquivo = await this.#buscar(parsed);
    this.#cache.set(url, arquivo);
    return arquivo;
  }

  #garantirDestinoSeguro(host: string): void {
    if (ehIpLiteral(host) && ipBloqueado(host)) {
      throw new DestinoBloqueadoError(`host "${host}" é um IP interno.`);
    }
    if (hostnameInternoBloqueado(host)) {
      throw new DestinoBloqueadoError(`host "${host}" aponta para destino interno.`);
    }
  }

  async #buscar(url: URL): Promise<ArquivoBaixado> {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), this.#opcoes.timeoutMs);
    try {
      const resposta = await this.#fetchImpl(url, {
        signal: controle.signal,
        redirect: 'error', // redirecionamentos burlariam a checagem de SSRF
      });
      if (!resposta.ok) {
        throw new DownloadError(
          `Falha ao baixar "${url.href}": HTTP ${resposta.status} ${resposta.statusText}.`,
        );
      }
      const contentType = resposta.headers.get('content-type') ?? undefined;
      const bytes = await this.#lerCorpoLimitado(resposta, url.href);
      const hash = await sha256Hex(bytes);
      const tipo = detectarTipo(bytes, contentType);
      return {
        bytes,
        ...(contentType !== undefined ? { contentType } : {}),
        hash,
        tipo,
        tamanhoBytes: bytes.byteLength,
      };
    } catch (causa) {
      if (causa instanceof DownloadError || causa instanceof DestinoBloqueadoError) throw causa;
      if (causa instanceof Error && causa.name === 'AbortError') {
        throw new DownloadError(
          `Timeout ao baixar "${url.href}" (limite de ${this.#opcoes.timeoutMs} ms).`,
        );
      }
      const motivo = causa instanceof Error ? causa.message : String(causa);
      throw new DownloadError(`Falha ao baixar "${url.href}": ${motivo}.`);
    } finally {
      clearTimeout(timer);
    }
  }

  async #lerCorpoLimitado(resposta: Response, href: string): Promise<Uint8Array> {
    const { maxBytes } = this.#opcoes;

    const declarado = Number(resposta.headers.get('content-length'));
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      throw new DownloadError(
        `Arquivo "${href}" excede o limite de ${maxBytes} bytes (Content-Length=${declarado}).`,
      );
    }

    const corpo = resposta.body;
    if (!corpo) {
      const buffer = new Uint8Array(await resposta.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        throw new DownloadError(`Arquivo "${href}" excede o limite de ${maxBytes} bytes.`);
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
          throw new DownloadError(`Arquivo "${href}" excede o limite de ${maxBytes} bytes.`);
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
}

/** Cria um {@link FileFetcher} Workers-native com os limites informados. */
export function criarFileFetcherWorkers(opcoes?: Partial<OpcoesDownload>): FileFetcher {
  return new FileFetcherWorkers(opcoes);
}
