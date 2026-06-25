import type { Job, ProgressoJob } from '../types/index.js';

/** Handler que o worker registra para processar cada job retirado da fila. */
export type JobHandler = (job: Job) => Promise<void>;

/**
 * Fila de jobs + consulta de progresso. Implementação: fatia F5.
 *
 * O v1 pode começar com uma fila in-memory (sem infra) atrás desta interface
 * e migrar para BullMQ/Redis depois, sem tocar no resto (CLAUDE.md §2).
 */
export interface JobQueue {
  /** Enfileira um job para processamento assíncrono. */
  enfileirar(job: Job): Promise<void>;
  /** Registra o handler do worker (chamado para cada job). */
  processar(handler: JobHandler): void;
  /** Progresso agregado de um job, para a devolutiva na tela. */
  progresso(jobId: string): Promise<ProgressoJob | undefined>;
}

// --- Implementação (fatia F5) -------------------------------------------------
export { FilaEmMemoria } from './fila-em-memoria.js';
