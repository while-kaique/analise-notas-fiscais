/**
 * Política **pura** "perguntar só se incerto" (spec §6, decisão 3).
 *
 * Dado um mapeamento já produzido (pela IA ou vindo do cache) e a entrada que o pediu,
 * decide se o sistema pode processar automaticamente ou se precisa de confirmação humana.
 * Regra: processa sozinho quando os papéis **críticos** (`cupom`, link de NF, `status`)
 * existem, têm confiança ≥ limiar e não contradizem os exemplos.
 */
import type { EntradaMapeamento } from '../contratos.js';
import type { MapeamentoColunas } from '../tipos.js';
import { LIMIAR_CONFIANCA_PADRAO, papeisCriticos } from './papeis.js';
import { coerenciaPapelColuna } from './heuristicas.js';

/**
 * Papéis críticos que são colunas de **saída** (escritas pelo sistema). Diferente dos de
 * entrada, uma coluna de saída ausente **não** trava o processamento — é criada no nome
 * padrão (CLAUDE.md §4). Só pausamos quando ela existe, mas o casamento ficou incerto.
 */
const CRITICOS_SAIDA = new Set<string>(['status']);

/** Um papel crítico que está abaixo do limiar de confiança. */
export interface PapelIncerto {
  papel: string;
  coluna: string;
  confianca: number;
}

/** Resultado da avaliação do mapeamento (alimenta a UI de confirmação — C6). */
export interface AvaliacaoMapeamento {
  /** `true` se algum crítico falta, está abaixo do limiar, ou contradiz os exemplos. */
  precisaConfirmar: boolean;
  /** Limiar de confiança aplicado. */
  limiar: number;
  /** Papéis críticos considerados (derivados da entrada). */
  criticos: readonly string[];
  /** Críticos de **entrada** sem coluna mapeada (travam o processamento). */
  faltando: readonly string[];
  /** Críticos de **saída** ausentes — serão criados no nome padrão (não travam). */
  saidaACriar: readonly string[];
  /** Críticos mapeados, porém com confiança < limiar. */
  baixaConfianca: readonly PapelIncerto[];
  /** Críticos cujos exemplos contradizem o papel (ex.: link sem URL). */
  incoerentes: readonly PapelIncerto[];
}

export interface OpcoesPolitica {
  /** Sobrescreve {@link LIMIAR_CONFIANCA_PADRAO}. */
  limiar?: number;
}

/**
 * Avalia um mapeamento contra os papéis críticos da entrada. Usa `entrada.exemplos`
 * (quando houver) para a checagem de coerência via heurística.
 */
export function avaliarMapeamento(
  mapa: MapeamentoColunas,
  entrada: EntradaMapeamento,
  opts: OpcoesPolitica = {},
): AvaliacaoMapeamento {
  const limiar = opts.limiar ?? LIMIAR_CONFIANCA_PADRAO;
  const criticos = papeisCriticos(entrada);

  const faltando: string[] = [];
  const saidaACriar: string[] = [];
  const baixaConfianca: PapelIncerto[] = [];
  const incoerentes: PapelIncerto[] = [];

  for (const papel of criticos) {
    const mapeado = mapa[papel];
    if (mapeado === undefined) {
      if (CRITICOS_SAIDA.has(papel)) saidaACriar.push(papel);
      else faltando.push(papel);
      continue;
    }
    if (mapeado.confianca < limiar) {
      baixaConfianca.push({ papel, coluna: mapeado.coluna, confianca: mapeado.confianca });
    }
    const exemplos = entrada.exemplos?.[mapeado.coluna];
    if (coerenciaPapelColuna(papel, exemplos) === 'nao') {
      incoerentes.push({ papel, coluna: mapeado.coluna, confianca: mapeado.confianca });
    }
  }

  const precisaConfirmar =
    faltando.length > 0 || baixaConfianca.length > 0 || incoerentes.length > 0;

  return { precisaConfirmar, limiar, criticos, faltando, saidaACriar, baixaConfianca, incoerentes };
}
