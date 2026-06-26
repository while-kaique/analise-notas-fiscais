/**
 * Barril do mapeamento de colunas por IA (fatia **C2** — spec §6).
 *
 * Mapeia o cabeçalho real do formulário (que muda por marca/mês) nos papéis conhecidos
 * via AI Proxy, com confiança, política "perguntar só se incerto" e cache por perfil.
 */

// Catálogo de papéis + utilitários
export {
  LIMIAR_CONFIANCA_PADRAO,
  PAPEIS_LINK_NF,
  DESCRICOES_PAPEL,
  descricaoPapel,
  papeisSolicitados,
  papeisCriticos,
  papeisCriticosEntrada,
} from './papeis.js';

// Prompt (puro)
export { montarMensagensMapeamento } from './prompt.js';

// Parse robusto da resposta da IA
export { parsearRespostaMapeamento } from './parse.js';

// Heurísticas de coerência papel↔coluna
export { coerenciaPapelColuna, type Coerencia } from './heuristicas.js';

// Política "perguntar só se incerto"
export {
  avaliarMapeamento,
  type AvaliacaoMapeamento,
  type PapelIncerto,
  type OpcoesPolitica,
} from './politica.js';

// Mapeador sobre o ClienteLlm (AI Proxy)
export { MapeadorColunasIa, type OpcoesMapeador } from './mapeador-ia.js';

// Resolução com cache por perfil
export {
  resolverMapeamento,
  cacheValido,
  type ResolucaoMapeamento,
  type DepsResolver,
  type CacheMapeamento,
} from './resolver.js';
