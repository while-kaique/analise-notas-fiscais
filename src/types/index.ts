/**
 * Barril de tipos compartilhados. Importe daqui: `import type { ArquivoBaixado } from '../types/index.js'`.
 *
 * No v2 (conferência por cupom) os tipos genéricos do v1 (`LinhaEntrada`/`LinhaResultado`/
 * `Job`/`Nota`/`TokensGoogle`) foram removidos junto com o pipeline genérico — restam só
 * os tipos de arquivo, ainda usados pelo download e pela extração de NF.
 */
export type { TipoArquivo, ArquivoBaixado } from './arquivo.js';
