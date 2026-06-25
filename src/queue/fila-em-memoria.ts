import type {
  Job,
  ProgressoJob,
  StatusJob,
  StatusLinha,
  LinhaResultado,
} from '../types/index.js';
import type { JobQueue, JobHandler } from './index.js';
import type { OnProgresso } from '../pipeline/index.js';

function agora(): string {
  return new Date().toISOString();
}

/** Estado por linha que a fila agrega para montar o `ProgressoJob`. */
interface EstadoLinha {
  status: StatusLinha;
  valorCentavos: number;
}

/** Estado interno acumulado de um job na fila. */
interface EstadoJob {
  statusJob: StatusJob;
  porLinha: Map<number, EstadoLinha>;
  atualizadoEm: string;
}

function agregar(jobId: string, e: EstadoJob): ProgressoJob {
  let pendentes = 0;
  let processando = 0;
  let concluidos = 0;
  let erros = 0;
  let valorTotalCentavos = 0;

  for (const linha of e.porLinha.values()) {
    switch (linha.status) {
      case 'PENDENTE':
        pendentes++;
        break;
      case 'PROCESSANDO':
        processando++;
        break;
      case 'CONCLUIDO':
        concluidos++;
        valorTotalCentavos += linha.valorCentavos;
        break;
      case 'ERRO':
        erros++;
        break;
    }
  }

  return {
    jobId,
    status: e.statusJob,
    total: e.porLinha.size,
    pendentes,
    processando,
    concluidos,
    erros,
    valorTotalCentavos,
    atualizadoEm: e.atualizadoEm,
  };
}

/**
 * Fila de jobs **in-memory** (v1, sem infra) atrás do contrato `JobQueue`
 * (CLAUDE.md §2 — migra para BullMQ/Redis depois sem tocar no resto).
 *
 * Processa um job por vez, em ordem FIFO; um job que falha não derruba a fila
 * (vira status `FALHOU`). O progresso por linha é alimentado pelo pipeline via
 * `onProgressoDe(jobId)`, que devolve um `OnProgresso` ligado ao job — o ponto
 * de costura para a F6:
 *
 * ```ts
 * const fila = new FilaEmMemoria();
 * fila.processar((job) =>
 *   processarJob(job, deps, { onProgresso: fila.onProgressoDe(job.id) }),
 * );
 * await fila.enfileirar(job);
 * ```
 */
export class FilaEmMemoria implements JobQueue {
  private handler: JobHandler | undefined;
  private readonly estados = new Map<string, EstadoJob>();
  private readonly pendentes: Job[] = [];
  private drenando = false;

  async enfileirar(job: Job): Promise<void> {
    this.estados.set(job.id, {
      statusJob: 'CRIADO',
      porLinha: new Map(),
      atualizadoEm: job.criadoEm || agora(),
    });
    this.pendentes.push(job);
    this.drenar();
  }

  processar(handler: JobHandler): void {
    this.handler = handler;
    this.drenar();
  }

  async progresso(jobId: string): Promise<ProgressoJob | undefined> {
    const e = this.estados.get(jobId);
    return e ? agregar(jobId, e) : undefined;
  }

  /**
   * Cria um `OnProgresso` ligado a este job. O pipeline o chama por linha
   * (status inicial e final); aqui a fila apenas acumula para o `progresso()`.
   */
  onProgressoDe(jobId: string): OnProgresso {
    return (resultado: LinhaResultado): void => {
      const e = this.estados.get(jobId);
      if (!e) return;
      e.porLinha.set(resultado.numeroLinha, {
        status: resultado.status,
        valorCentavos:
          resultado.status === 'CONCLUIDO'
            ? (resultado.nota?.valorTotalCentavos ?? 0)
            : 0,
      });
      e.atualizadoEm = agora();
    };
  }

  private drenar(): void {
    if (this.drenando || !this.handler) return;
    this.drenando = true;
    void this.loop();
  }

  private async loop(): Promise<void> {
    try {
      while (this.handler && this.pendentes.length > 0) {
        const job = this.pendentes.shift()!;
        const handler = this.handler;
        const e = this.estados.get(job.id);
        if (e) {
          e.statusJob = 'PROCESSANDO';
          e.atualizadoEm = agora();
        }
        try {
          await handler(job);
          if (e) e.statusJob = 'CONCLUIDO';
        } catch {
          // Falha isolada no nível do job: registra e segue a fila.
          if (e) e.statusJob = 'FALHOU';
        }
        if (e) e.atualizadoEm = agora();
      }
    } finally {
      this.drenando = false;
    }
    // Se algo entrou na fila bem no fim da drenagem, re-dispara.
    if (this.handler && this.pendentes.length > 0) this.drenar();
  }
}
