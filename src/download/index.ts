import type { ArquivoBaixado } from '../types/index.js';

/** Limites de segurança para o download (ver CLAUDE.md §6). */
export interface OpcoesDownload {
  /** Tamanho máximo do arquivo em bytes. */
  maxBytes: number;
  /** Timeout da requisição em ms. */
  timeoutMs: number;
}

/**
 * Baixa o arquivo (PDF/XML) de um link da planilha.
 * Implementação: fatia F4.
 *
 * Cuidados obrigatórios (CLAUDE.md §6):
 * - **SSRF guard**: bloquear IPs internos/localhost/link-local; apenas http/https.
 * - Respeitar `maxBytes` e `timeoutMs`.
 * - Calcular o `hash` (SHA-256) para cache — não rebaixar o mesmo arquivo.
 *
 * Deve lançar erro com mensagem acionável em caso de link morto, tamanho
 * excedido, timeout ou destino bloqueado.
 */
export interface FileFetcher {
  baixar(url: string): Promise<ArquivoBaixado>;
}
