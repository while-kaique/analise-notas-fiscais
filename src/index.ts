/**
 * Barril raiz: tipos e contratos compartilhados de todas as camadas.
 * As fatias (F1…F6) implementam as interfaces; nada de I/O vive aqui.
 */
export * from './types/index.js';
export type { GoogleAuthProvider } from './auth/index.js';
// F3 — implementação de auth (OAuth do usuário).
export {
  GoogleAuthProviderImpl,
  criarGoogleAuthProvider,
  ESCOPO_SHEETS,
  type ConfigOAuth,
} from './auth/index.js';
export type {
  SheetsClient,
  LeituraPlanilha,
  CriarSheetsClient,
  ExtrairSpreadsheetId,
} from './sheets/index.js';
// F3 — implementação de sheets (I/O por cabeçalho, escrita em lote).
export {
  extrairSpreadsheetId,
  SheetsClientImpl,
  criarSheetsClient,
  criarSheetsClientCom,
  construirMapaColunas,
  acharColuna,
  acharColunaLink,
  colunaParaA1,
  centavosParaReais,
  resultadoParaCelulas,
  CABECALHOS_LINK,
  type CelulaEscrita,
} from './sheets/index.js';
export type { FileFetcher, OpcoesDownload } from './download/index.js';
// F4 — implementação do download.
export {
  FileFetcherImpl,
  criarFileFetcher,
  DownloadError,
  OPCOES_PADRAO,
  validarUrl,
  ipBloqueado,
  DestinoBloqueadoError,
  ESQUEMAS_PERMITIDOS,
  detectarTipo,
  type DepsFileFetcher,
  type FetchLike,
  type ResolverDns,
} from './download/index.js';
export type {
  NotaExtractor,
  OcrProvider,
  ResultadoOcr,
} from './extract/index.js';
// F2 — implementação de extract (cascata XML → texto do PDF → OCR).
export {
  NotaExtractorImpl,
  criarNotaExtractor,
  TesseractOcrProvider,
  criarTesseractOcrProvider,
  extrairCamposDeXml,
  extrairCamposDeTexto,
  montarNotaExtraida,
  PESO_FONTE,
  lerTextoPdf,
  rasterizarPdf,
  type DependenciasExtractor,
  type CamposBrutos,
  type RasterizadorPdf,
  type OpcoesRaster,
} from './extract/index.js';
export {
  validarCnpj,
  validarCpf,
  somenteDigitos,
  valorParaCentavos,
  normalizarData,
} from './parsing/index.js';
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
export {
  processarLinha,
  processarJob,
  processarComConcorrencia,
  validarNotaExtraida,
  CONCORRENCIA_PADRAO,
} from './pipeline/index.js';
export type { JobQueue, JobHandler } from './queue/index.js';
export { FilaEmMemoria } from './queue/index.js';
export {
  loadConfig,
  type Config,
  type ConfigGoogleOAuth,
  type ConfigOcr,
  type ConfigLimites,
} from './config/index.js';
