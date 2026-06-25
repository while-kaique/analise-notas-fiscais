/**
 * Cliente do **Cloudflare OCR Worker** — PDF (bytes) → texto.
 *
 * O worker (`OCR_WORKER_URL`) faz, server-side e num único passo, a extração da
 * camada de texto **e** o OCR de PDFs escaneados. Substitui a antiga cascata local
 * (pdf-parse + rasterização pdfjs + Tesseract), removendo as dependências pesadas.
 *
 * Contrato (espelha o uso em produção do godocs):
 *   POST <url>
 *     Content-Type: application/pdf
 *     Authorization: Bearer <token>
 *     body: bytes crus do PDF
 *   → 200 JSON { text?: string, content?: string }
 *
 * O token é segredo (CLAUDE.md §6): vem de `OCR_WORKER_TOKEN`, nunca do código.
 */

export interface OcrWorkerConfig {
  /** URL do worker (`OCR_WORKER_URL`). */
  url: string;
  /** Token Bearer (`OCR_WORKER_TOKEN`) — nunca commitar. */
  token: string;
  /** Timeout da requisição em ms. Default 60000 (OCR pode ser lento). */
  timeoutMs?: number;
  /** `fetch` injetável (para testes). Default: `fetch` global. */
  fetchImpl?: typeof fetch;
}

/** Função que recebe os bytes de um PDF e devolve o texto extraído. */
export type LeitorPdf = (bytes: Uint8Array) => Promise<string>;

const TIMEOUT_PADRAO = 60_000;

/**
 * Cria um `LeitorPdf` que chama o OCR Worker. **Lança** (mensagem acionável) se a
 * config estiver incompleta, se o worker responder != 2xx, ou no timeout — o
 * orquestrador (`NotaExtractor`) captura e transforma em aviso/baixa confiança.
 */
export function criarLeitorPdf(config: OcrWorkerConfig): LeitorPdf {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? TIMEOUT_PADRAO;

  return async (bytes) => {
    if (!config.url || !config.token) {
      throw new Error(
        'OCR Worker não configurado: defina OCR_WORKER_URL e OCR_WORKER_TOKEN.',
      );
    }

    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), timeoutMs);
    try {
      // Cópia com offset 0 → envia exatamente o conteúdo do PDF.
      const corpo = new Uint8Array(bytes);
      const resp = await fetchImpl(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          Authorization: `Bearer ${config.token}`,
        },
        body: corpo,
        signal: controle.signal,
      });

      if (!resp.ok) {
        const detalhe = await resp.text().catch(() => '');
        throw new Error(
          `OCR Worker retornou ${resp.status}${detalhe ? `: ${detalhe.slice(0, 200)}` : ''}`,
        );
      }

      const json = (await resp.json()) as { text?: string; content?: string };
      return json.text ?? json.content ?? '';
    } catch (erro) {
      if (erro instanceof Error && erro.name === 'AbortError') {
        throw new Error(`OCR Worker excedeu o timeout de ${timeoutMs}ms.`);
      }
      throw erro;
    } finally {
      clearTimeout(timer);
    }
  };
}
