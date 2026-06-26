/**
 * Barril do download via Google Drive (fatia C4). Consumido pela C5 (pipeline):
 * `import { criarBaixadorDrive, CredencialRefreshToken } from '../conferencia/drive/index.js'`.
 *
 * Não é re-exportado pelo barril `src/conferencia/index.ts` de propósito (evita conflito
 * de merge com as fatias paralelas C1/C2/C3); C5 importa deste sub-barril.
 */
export { extrairFileIdDrive, ehLinkDrive } from './link.js';
export {
  CredencialRefreshToken,
  urlConsentimentoServico,
  ESCOPOS_SERVICO,
  type CredencialServico,
  type OpcoesCredencial,
} from './credencial.js';
export {
  BaixadorDrive,
  criarBaixadorDrive,
  type OpcoesBaixadorDrive,
} from './baixador-drive.js';
export { ErroDrive, sha256Hex, type FetchLike } from './comum.js';
