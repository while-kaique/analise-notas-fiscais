/**
 * Barril do **pipeline de conferência** (v2 · fatia C5). Costura C1–C4 atrás dos
 * contratos. Consumido pela C6 (API/Worker + cron):
 *   `import { processarPerfil, LeitorPlanilhaRest } from '../conferencia/pipeline/index.js'`
 *
 * Sub-barril próprio (não toca `src/conferencia/index.ts`) — strangler-fig: o v1 genérico
 * só sai na C6, quando a API for religada a este pipeline.
 */
export {
  COLUNAS_BASE,
  normalizarCupom,
  indexarBase,
  montarLinhas,
  type IndiceBase,
} from './merge.js';
export {
  resultadoParaEscritas,
  centavosParaReaisBr,
  isoParaBr,
  statusDeRotulo,
} from './escrita.js';
export { processarFrente, type ContextoFrente } from './processar-frente.js';
export { processarSoma, type ContextoSoma } from './processar-soma.js';
export { processarPerfil, refDoFormUrl } from './processar-perfil.js';
export {
  BATCH_PADRAO,
  type DepsPipeline,
  type OpcoesProcessamento,
  type ResultadoFrente,
  type ResumoPerfil,
  type LinhaParaProcessar,
} from './tipos.js';

// Borda de planilha (LeitorPlanilha sobre Sheets REST).
export { LeitorPlanilhaRest, type OpcoesLeitor } from '../sheets/leitor-planilha-rest.js';
