/**
 * Barril do **coração de validação** da Conferência por Cupom (v2 · fatia C1).
 *
 * Funções puras (sem I/O), reusando a F1 (`src/parsing`). O orquestrador (C5) compõe:
 *
 * ```ts
 * const ini = validarNfInicial(linha, campos, marca);
 * if (!ini.precisaRetroativo) return ini.resultado;            // terminal ou APROVADO
 * const retro = validarComRetroativo({
 *   valorNfCentavos: ini.resultado.valorNfCentavos!,
 *   valorBaseCentavos: linha.valorEsperadoCentavos,
 *   mesAno: linha.mesAno,
 *   historico, statusBloqueantes: marca.statusBloqueantes,
 *   margemParcialCentavos: marca.margemParcialCentavos,
 * });
 * return { ...ini.resultado, ...retro };                       // status/retroativo refinados
 * ```
 *
 * Fonte de verdade da regra: `spec-docs/SPEC_CONFERENCIA_V2.md` §4 (resumo fiel de `fluxos_n8n/`).
 */
export { classificarStatus, statusEhMelhor, ORDEM_APROVACAO, type StatusAprovacao } from './status.js';
export {
  mesParaNumero,
  validarComRetroativo,
  type EntradaRetroativo,
  type ResultadoRetroativo,
} from './retroativo.js';
export { validarNfInicial, valorNfParaCentavos, type SaidaValidacaoInicial } from './nf.js';
export { reconciliarSoma, type EntradaSoma } from './soma.js';
