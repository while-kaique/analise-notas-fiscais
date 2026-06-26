/**
 * Barril do módulo **Conferência de NF por Cupom** (v2).
 * Importe daqui: `import { RepositorioPerfisMemoria, type Perfil } from '../conferencia/index.js'`.
 *
 * Fonte de verdade da regra de negócio: `spec-docs/SPEC_CONFERENCIA_V2.md`.
 */

// Tipos do domínio
export type {
  TipoFrente,
  PapelLinkNf,
  PlanilhaRef,
  ColunasSaida,
  Frente,
  Marca,
  Perfil,
  PapelColunaEntrada,
  ColunaMapeada,
  MapeamentoColunas,
  CamposNfBrutos,
  CamposNf,
  StatusConferencia,
  LinhaConferencia,
  ResultadoConferencia,
  EntradaHistorico,
  ResultadoSoma,
} from './tipos.js';
export { ROTULO_STATUS } from './tipos.js';

// Contratos (interfaces de camada — implementados em C1–C6)
export type {
  RegistroPlanilha,
  EscritaCelula,
  LeitorPlanilha,
  PapelMensagem,
  MensagemLlm,
  OpcoesLlm,
  ClienteLlm,
  ExtratorCampos,
  EntradaMapeamento,
  MapeadorColunas,
  BaixadorNf,
  RepositorioPerfis,
} from './contratos.js';

// Perfis (seed + repositório em memória)
export {
  STATUS_BLOQUEANTES_PADRAO,
  MARGEM_PARCIAL_CENTAVOS,
  colunasSaidaPadrao,
  MARCA_GOCASE,
  MARCA_GOBEAUTE,
  MARCAS_SEED,
  PERFIS_SEED,
} from './perfis/seed.js';
export { RepositorioPerfisMemoria } from './perfis/repositorio-memoria.js';

// Persistência (DDL aditivo do env.DB — wireado em C5/C6)
export { DDL_CONFERENCIA, initSchemaConferencia } from './persistencia/schema.js';

// Mapeamento de colunas por IA (C2 — spec §6): header→papéis, confiança, política e cache
export {
  LIMIAR_CONFIANCA_PADRAO,
  PAPEIS_LINK_NF,
  DESCRICOES_PAPEL,
  descricaoPapel,
  papeisSolicitados,
  papeisCriticos,
  papeisCriticosEntrada,
  montarMensagensMapeamento,
  parsearRespostaMapeamento,
  coerenciaPapelColuna,
  avaliarMapeamento,
  MapeadorColunasIa,
  resolverMapeamento,
  cacheValido,
} from './mapeamento/index.js';
export type {
  Coerencia,
  AvaliacaoMapeamento,
  PapelIncerto,
  OpcoesPolitica,
  OpcoesMapeador,
  ResolucaoMapeamento,
  DepsResolver,
  CacheMapeamento,
} from './mapeamento/index.js';
