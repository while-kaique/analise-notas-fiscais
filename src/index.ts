/**
 * Barril raiz: tipos e contratos compartilhados de todas as camadas.
 * As fatias (F1…F6) implementam as interfaces; nada de I/O vive aqui.
 */
export * from './types/index.js';
export type { GoogleAuthProvider } from './auth/index.js';
export type {
  SheetsClient,
  LeituraPlanilha,
  CriarSheetsClient,
  ExtrairSpreadsheetId,
} from './sheets/index.js';
export type { FileFetcher, OpcoesDownload } from './download/index.js';
export type {
  NotaExtractor,
  OcrProvider,
  ResultadoOcr,
} from './extract/index.js';
export type {
  ValidarCnpj,
  ValidarCpf,
  SomenteDigitos,
  ValorParaCentavos,
  NormalizarData,
} from './parsing/index.js';
export type {
  DependenciasPipeline,
  ProcessarLinha,
  ProcessarJob,
  OnProgresso,
} from './pipeline/index.js';
export type { JobQueue, JobHandler } from './queue/index.js';
export {
  loadConfig,
  type Config,
  type ConfigGoogleOAuth,
  type ConfigOcr,
  type ConfigLimites,
} from './config/index.js';
