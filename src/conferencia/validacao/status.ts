/**
 * Classificação de status por **comparação de valor** (spec §2.5 / §4.3) — função pura.
 *
 * Generaliza o n8n, que era binário (`Validado` se a diferença fosse < 1 centavo,
 * `Não validado` caso contrário). O v2 abre em três níveis tolerantes a uma margem:
 * - **APROVADO** — diferença exata (0 centavos);
 * - **PARCIAL** — diferença até a margem (default `3000` = R$ 30,00);
 * - **NAO_APROVADO** — diferença maior que a margem.
 *
 * Tudo em **centavos inteiros** (CLAUDE.md §5) — sem `parseFloat`/arredondamento aqui.
 */
import type { StatusConferencia } from '../tipos.js';

/** Os três status que saem da comparação de valor (subconjunto de `StatusConferencia`). */
export type StatusAprovacao = Extract<StatusConferencia, 'APROVADO' | 'PARCIAL' | 'NAO_APROVADO'>;

/**
 * Classifica a diferença (em centavos) entre o valor da NF e o esperado.
 * Aceita diferença com ou sem sinal (usa o módulo). `margemParcialCentavos` é o teto,
 * inclusivo, da faixa "Parcial"; com margem `0`, só `0` é APROVADO e o resto NAO_APROVADO.
 */
export function classificarStatus(diffCentavos: number, margemParcialCentavos: number): StatusAprovacao {
  const diff = Math.abs(diffCentavos);
  if (diff === 0) return 'APROVADO';
  if (diff <= margemParcialCentavos) return 'PARCIAL';
  return 'NAO_APROVADO';
}

/**
 * Ranking dos status, do pior (0) ao melhor (mais próximo de aprovado). Usado pela
 * Soma (spec §4.6: "se melhora, grava") para decidir se um novo status supera o atual.
 */
export const ORDEM_APROVACAO: Readonly<Record<StatusConferencia, number>> = {
  SEM_NF: 0,
  NAO_LEGIVEL: 1,
  CNPJ_DIFERENTE: 2,
  NAO_APROVADO: 3,
  PARCIAL: 4,
  APROVADO: 5,
};

/** `true` se `novo` representa um resultado melhor (mais aprovado) que `atual` (spec §4.6). */
export function statusEhMelhor(novo: StatusConferencia, atual: StatusConferencia): boolean {
  return ORDEM_APROVACAO[novo] > ORDEM_APROVACAO[atual];
}
