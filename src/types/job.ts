/**
 * Um Job representa o processamento de uma planilha inteira.
 * Uma planilha pode ter centenas de linhas: o processamento é assíncrono,
 * nunca dentro de uma request HTTP síncrona (ver CLAUDE.md §2).
 */
export type StatusJob =
  | 'CRIADO'
  | 'PROCESSANDO'
  | 'CONCLUIDO'
  | 'FALHOU'
  | 'CANCELADO';

export interface Job {
  /** Identificador único do job. */
  id: string;
  /** URL da planilha informada pelo usuário (não confiável; validar). */
  spreadsheetUrl: string;
  /** ID do spreadsheet extraído da URL. */
  spreadsheetId: string;
  /** Aba alvo (opcional; default = primeira aba). */
  aba?: string;
  /** Identificador do dono do job (usuário OAuth). */
  donoId: string;
  /** Criação em ISO 8601. */
  criadoEm: string;
  status: StatusJob;
}

/** Progresso agregado de um job — base da devolutiva na tela (web). */
export interface ProgressoJob {
  jobId: string;
  status: StatusJob;
  total: number;
  pendentes: number;
  processando: number;
  concluidos: number;
  erros: number;
  /** Soma dos valores das notas concluídas, em centavos. */
  valorTotalCentavos: number;
  atualizadoEm: string;
}
