import type {
  ArquivoBaixado,
  LeituraPlanilha,
  LinhaEntrada,
  LinhaResultado,
  MapaColunas,
  Nota,
  NotaExtraida,
} from '../../src/index.js';
import type { SheetsClient } from '../../src/sheets/index.js';
import type { FileFetcher } from '../../src/download/index.js';
import type { NotaExtractor } from '../../src/extract/index.js';

/** Nota válida de exemplo (CNPJ com 14 dígitos, data ISO, valor em centavos). */
export function notaValida(over: Partial<Nota> = {}): Nota {
  return {
    cnpjEmitente: '11222333000181',
    dataEmissao: '2026-06-25',
    valorTotalCentavos: 123456,
    ...over,
  };
}

/** Arquivo baixado de mentira (conteúdo irrelevante para o pipeline). */
export function arquivoFake(): ArquivoBaixado {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    hash: 'deadbeef',
    tipo: 'pdf',
    tamanhoBytes: 3,
  };
}

/** Fetcher que registra as URLs baixadas e pode falhar para URLs marcadas. */
export class FetcherFake implements FileFetcher {
  readonly baixadas: string[] = [];
  constructor(private readonly falharEm: Set<string> = new Set()) {}
  async baixar(url: string): Promise<ArquivoBaixado> {
    this.baixadas.push(url);
    if (this.falharEm.has(url)) {
      throw new Error(`link morto: ${url}`);
    }
    return arquivoFake();
  }
}

/** Extractor que devolve uma `NotaExtraida` por URL, ou lança/produz inválida. */
export class ExtractorFake implements NotaExtractor {
  chamadas = 0;
  constructor(
    private readonly responder: (a: ArquivoBaixado) => NotaExtraida,
  ) {}
  async extrair(arquivo: ArquivoBaixado): Promise<NotaExtraida> {
    this.chamadas++;
    return this.responder(arquivo);
  }
}

export function extraidaOk(over: Partial<Nota> = {}): NotaExtraida {
  return { nota: notaValida(over), fonte: 'XML', confianca: 0.99, avisos: [] };
}

/** SheetsClient em memória: grava lotes e devolve as linhas configuradas. */
export class SheetsFake implements SheetsClient {
  readonly lotes: LinhaResultado[][] = [];
  garantirChamadaCom: readonly string[] | undefined;
  constructor(private readonly linhas: LinhaEntrada[]) {}

  async lerLinhas(): Promise<LeituraPlanilha> {
    return { mapa: {}, linhas: this.linhas, total: this.linhas.length };
  }

  async garantirColunas(
    _id: string,
    headers: readonly string[],
  ): Promise<MapaColunas> {
    this.garantirChamadaCom = headers;
    const mapa: MapaColunas = {};
    headers.forEach((h, i) => {
      mapa[h] = i;
    });
    return mapa;
  }

  async escreverResultados(
    _id: string,
    resultados: readonly LinhaResultado[],
  ): Promise<void> {
    this.lotes.push([...resultados]);
  }

  /** Achatado de todos os lotes, na ordem em que foram escritos. */
  todosEscritos(): LinhaResultado[] {
    return this.lotes.flat();
  }
}
