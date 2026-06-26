/**
 * Reconciliação por **soma** (spec §4.6) — função pura, só no perfil Influencers.
 *
 * Alguns cupons recebem duas notas no mesmo mês: uma do influencer e uma da assessoria.
 * Cada uma sozinha não bate com o esperado da base, mas a **soma** das duas, sim. Esta
 * função calcula `influ + assessoria` e classifica contra a base (espelha o nó de Soma do
 * n8n, que era binário; aqui usa os 3 níveis via `classificarStatus`).
 *
 * O "quando aplicar" (ambas as frentes preenchidas, ambas não-Aprovadas) e o "se melhora,
 * grava" (via {@link statusEhMelhor}) ficam no orquestrador (C5) — aqui é só o cálculo puro.
 */
import type { ResultadoSoma } from '../tipos.js';
import { classificarStatus } from './status.js';

export interface EntradaSoma {
  cupom: string;
  valorNfInfluCentavos: number;
  valorNfAssessoriaCentavos: number;
  /** Valor esperado da base para o cupom/mês, em centavos. */
  valorBaseCentavos: number;
  margemParcialCentavos: number;
}

export function reconciliarSoma(entrada: EntradaSoma): ResultadoSoma {
  const somaCentavos = entrada.valorNfInfluCentavos + entrada.valorNfAssessoriaCentavos;
  const status = classificarStatus(somaCentavos - entrada.valorBaseCentavos, entrada.margemParcialCentavos);
  return {
    cupom: entrada.cupom,
    status,
    somaCentavos,
    valorEsperadoCentavos: entrada.valorBaseCentavos,
  };
}
