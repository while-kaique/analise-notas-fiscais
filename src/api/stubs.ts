/**
 * Stubs de `FileFetcher` (F4) e `NotaExtractor` (F2) para o runtime Workers.
 *
 * Por que stubs (CLAUDE.md §11 — task FUND): no Cloudflare Workers o download da F4
 * usa `node:dns` e a extração da F2 usa `pdf-parse`/Tesseract (binário nativo) —
 * nenhum roda no edge. Até essas fatias ganharem versões Workers-native (download
 * por `fetch` com guard de host, OCR via HTTP), estes stubs **lançam erro acionável**.
 *
 * Como `processarLinha` (F5) nunca propaga exceção (falha isolada), cada linha vira
 * status `ERRO` com a mensagem abaixo — o job conclui, a planilha registra o motivo,
 * e a troca pelos provedores reais é **uma linha** em {@link montarDepsStub}.
 */
import type { ArquivoBaixado, NotaExtraida } from '../types/index.js';
import type { FileFetcher } from '../download/index.js';
import type { NotaExtractor } from '../extract/index.js';
import type { DependenciasPipeline } from '../pipeline/index.js';
import type { SheetsClient } from '../sheets/index.js';

class FetcherIndisponivel implements FileFetcher {
  async baixar(_url: string): Promise<ArquivoBaixado> {
    throw new Error(
      'Download indisponível no runtime Workers (F4 usa node:dns). ' +
        'Aguardando versão Workers-native do FileFetcher (task FUND).',
    );
  }
}

class ExtractorIndisponivel implements NotaExtractor {
  async extrair(_arquivo: ArquivoBaixado): Promise<NotaExtraida> {
    throw new Error(
      'Extração indisponível no runtime Workers (F2 usa pdf-parse/Tesseract). ' +
        'Aguardando OCR via HTTP e parser de PDF compatível (task FUND).',
    );
  }
}

/**
 * Monta as `DependenciasPipeline` para o Worker: `sheets` real (Workers-native) +
 * `fetcher`/`extractor` stub. Trocar pelos provedores reais aqui quando F2/F4 migrarem.
 */
export function montarDepsStub(sheets: SheetsClient): DependenciasPipeline {
  return {
    sheets,
    fetcher: new FetcherIndisponivel(),
    extractor: new ExtractorIndisponivel(),
  };
}
