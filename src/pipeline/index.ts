import type { LinhaEntrada, LinhaResultado, Job } from '../types/index.js';
import type { SheetsClient } from '../sheets/index.js';
import type { FileFetcher } from '../download/index.js';
import type { NotaExtractor } from '../extract/index.js';

/** Dependências injetadas no pipeline — tudo atrás de interface (I/O nas bordas). */
export interface DependenciasPipeline {
  sheets: SheetsClient;
  fetcher: FileFetcher;
  extractor: NotaExtractor;
}

/**
 * Processa **uma** linha: baixa → extrai → valida → devolve o resultado.
 * NÃO deve lançar: erro de uma linha vira `LinhaResultado` com status ERRO
 * e mensagem acionável (falha isolada, CLAUDE.md §3).
 */
export type ProcessarLinha = (
  linha: LinhaEntrada,
  deps: DependenciasPipeline,
) => Promise<LinhaResultado>;

/** Reporta progresso conforme as linhas concluem (alimenta a devolutiva). */
export type OnProgresso = (resultado: LinhaResultado) => void;

/**
 * Orquestra o job inteiro: lê a planilha, garante colunas, processa as linhas
 * com concorrência limitada, escreve em lote e mantém o status por linha.
 *
 * Idempotência (CLAUDE.md §3/§4): pula linhas já CONCLUIDO; marca PROCESSANDO
 * antes de iniciar cada linha para evitar corrida em reprocessos.
 * Implementação: fatia F5.
 */
export type ProcessarJob = (
  job: Job,
  deps: DependenciasPipeline,
  opts?: { concorrencia?: number; onProgresso?: OnProgresso },
) => Promise<void>;

// --- Implementação (fatia F5) -------------------------------------------------
export { processarLinha } from './processar-linha.js';
export { processarJob, CONCORRENCIA_PADRAO } from './processar-job.js';
export { processarComConcorrencia } from './concorrencia.js';
export { validarNotaExtraida } from './validacao.js';
