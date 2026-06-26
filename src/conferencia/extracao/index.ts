/**
 * Barril da camada de **extração de campos da NF** (v2 · fatia C3).
 *
 * Importe daqui:
 *   `import { criarClienteLlm, criarExtratorCampos, criarExtracaoNf } from '../conferencia/extracao/index.js'`
 *
 * Fica num barril próprio (e **não** no `src/conferencia/index.ts` compartilhado) para
 * não conflitar com as fatias C1/C2/C4 que correm em paralelo. A C5 importa por este
 * subcaminho ao montar o pipeline.
 */

// Cliente do AI Proxy (porte de godocs/llm.ts) — implementa `ClienteLlm` (C0).
export type { ConfigLlm } from './cliente-llm.js';
export { criarClienteLlm, dropUnsupportedParam } from './cliente-llm.js';

// Extrator de campos (prompt verbatim §5.4) — implementa `ExtratorCampos` (C0).
export { PROMPT_SISTEMA_NF, parseCamposNf, criarExtratorCampos } from './extrator-campos.js';

// Hash + cache de extração (por hash do arquivo).
export { sha256Hex } from './hash.js';
export type { CacheExtracao, DependenciasExtracao, ExtracaoNf } from './cache.js';
export { CacheExtracaoMemoria, criarExtracaoNf } from './cache.js';

// OCR Worker da F2 reusado (PDF → texto), reexposto por conveniência desta camada.
export { criarLeitorPdf } from '../../extract/ocr-worker.js';
export type { LeitorPdf, OcrWorkerConfig } from '../../extract/ocr-worker.js';
