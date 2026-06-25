import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { ArquivoBaixado } from '../types/index.js';
import type { FileFetcher, OpcoesDownload } from './index.js';
import { DestinoBloqueadoError, ipBloqueado, validarUrl } from './ssrf.js';
import { detectarTipo } from './tipo-arquivo.js';

/** Limites padrão (sobrescritos pelo `loadConfig`/chamador). */
export const OPCOES_PADRAO: OpcoesDownload = {
  maxBytes: 20 * 1024 * 1024, // 20 MB
  timeoutMs: 30_000,
};

/** Erro de download com mensagem acionável (link/tamanho/timeout). */
export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

/** Assinatura de `fetch` — injetável nos testes (sem rede real). */
export type FetchLike = typeof fetch;

/** Resolve um hostname para IPs — injetável nos testes. */
export type ResolverDns = (host: string) => Promise<readonly string[]>;

export interface DepsFileFetcher {
  fetchImpl?: FetchLike;
  resolverDns?: ResolverDns;
  opcoes?: Partial<OpcoesDownload>;
}

const resolverDnsPadrao: ResolverDns = async (host) => {
  const enderecos = await lookup(host, { all: true });
  return enderecos.map((e) => e.address);
};

/** Remove colchetes de um host IPv6 literal (`[::1]` → `::1`). */
function semColchetes(host: string): string {
  return host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
}

/**
 * Implementação do {@link FileFetcher} (fatia F4).
 *
 * - **SSRF guard**: só http/https; resolve o DNS e bloqueia se **qualquer** IP
 *   resolvido for interno/privado/loopback/link-local (ver `ssrf.ts`).
 * - Respeita `maxBytes` (aborta o stream ao exceder) e `timeoutMs` (AbortSignal).
 * - Calcula o **SHA-256** do conteúdo e detecta o tipo (PDF/XML).
 * - **Cache por URL**: o mesmo link não é rebaixado na mesma instância
 *   (CLAUDE.md §5 — não reprocessar o mesmo arquivo à toa).
 *
 * Limitação conhecida: a checagem de IP e o `fetch` resolvem o DNS
 * separadamente (janela de DNS-rebinding). Aceitável no v1; mitigar depois
 * pinando o IP resolvido na conexão.
 */
export class FileFetcherImpl implements FileFetcher {
  private readonly fetchImpl: FetchLike;
  private readonly resolverDns: ResolverDns;
  private readonly opcoes: OpcoesDownload;
  private readonly cache = new Map<string, ArquivoBaixado>();

  constructor(deps: DepsFileFetcher = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.resolverDns = deps.resolverDns ?? resolverDnsPadrao;
    this.opcoes = { ...OPCOES_PADRAO, ...deps.opcoes };
  }

  async baixar(url: string): Promise<ArquivoBaixado> {
    const emCache = this.cache.get(url);
    if (emCache) return emCache;

    const parsed = validarUrl(url);
    await this.garantirDestinoSeguro(parsed.hostname);

    const arquivo = await this.buscar(parsed);
    this.cache.set(url, arquivo);
    return arquivo;
  }

  /** Resolve o host e bloqueia se algum IP for interno (CLAUDE.md §6). */
  private async garantirDestinoSeguro(hostname: string): Promise<void> {
    const host = semColchetes(hostname);
    let ips: readonly string[];
    try {
      ips = await this.resolverDns(host);
    } catch (causa) {
      throw new DestinoBloqueadoError(
        `não foi possível resolver o host "${host}".`,
      );
    }
    if (ips.length === 0) {
      throw new DestinoBloqueadoError(`host "${host}" sem IPs resolvidos.`);
    }
    for (const ip of ips) {
      if (ipBloqueado(ip)) {
        throw new DestinoBloqueadoError(
          `host "${host}" resolve para IP interno (${ip}).`,
        );
      }
    }
  }

  /** Faz a requisição com timeout e lê o corpo respeitando `maxBytes`. */
  private async buscar(url: URL): Promise<ArquivoBaixado> {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), this.opcoes.timeoutMs);
    try {
      const resposta = await this.fetchImpl(url, {
        signal: controle.signal,
        redirect: 'error', // redirecionamentos burlariam a checagem de SSRF
      });
      if (!resposta.ok) {
        throw new DownloadError(
          `Falha ao baixar "${url.href}": HTTP ${resposta.status} ${resposta.statusText}.`,
        );
      }
      const contentType = resposta.headers.get('content-type') ?? undefined;
      const bytes = await this.lerCorpoLimitado(resposta, url.href);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const tipo = detectarTipo(bytes, contentType);
      return {
        bytes,
        ...(contentType !== undefined ? { contentType } : {}),
        hash,
        tipo,
        tamanhoBytes: bytes.byteLength,
      };
    } catch (causa) {
      if (causa instanceof DownloadError || causa instanceof DestinoBloqueadoError) {
        throw causa;
      }
      if (causa instanceof Error && causa.name === 'AbortError') {
        throw new DownloadError(
          `Timeout ao baixar "${url.href}" (limite de ${this.opcoes.timeoutMs} ms).`,
        );
      }
      const motivo = causa instanceof Error ? causa.message : String(causa);
      throw new DownloadError(`Falha ao baixar "${url.href}": ${motivo}.`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Lê o stream do corpo acumulando bytes, abortando se exceder `maxBytes`. */
  private async lerCorpoLimitado(
    resposta: Response,
    href: string,
  ): Promise<Uint8Array> {
    const { maxBytes } = this.opcoes;

    // Atalho: se o servidor informa um Content-Length maior que o limite, corta cedo.
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
        throw new DownloadError(
          `Arquivo "${href}" excede o limite de ${maxBytes} bytes.`,
        );
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
          throw new DownloadError(
            `Arquivo "${href}" excede o limite de ${maxBytes} bytes.`,
          );
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

/** Cria um {@link FileFetcher} com os limites informados (ou os padrões). */
export function criarFileFetcher(
  opcoes?: Partial<OpcoesDownload>,
): FileFetcher {
  return new FileFetcherImpl(opcoes !== undefined ? { opcoes } : {});
}
