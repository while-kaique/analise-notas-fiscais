import type { Nota, FonteDados } from './nota.js';

/**
 * Vocabulário fixo de status por linha (ver CLAUDE.md §4).
 * Transição esperada: PENDENTE → PROCESSANDO → CONCLUIDO | ERRO.
 */
export type StatusLinha = 'PENDENTE' | 'PROCESSANDO' | 'CONCLUIDO' | 'ERRO';

/** Nomes canônicos das colunas que o sistema escreve na planilha.
 *  As colunas são identificadas/escritas pelo **cabeçalho**, nunca por índice fixo. */
export const COLUNAS = {
  status: 'Status',
  cnpjEmitente: 'CNPJ Emitente',
  dataEmissao: 'Data Emissão',
  valor: 'Valor',
  erro: 'Erro',
  processadoEm: 'Processado em',
} as const;

export type NomeColuna = (typeof COLUNAS)[keyof typeof COLUNAS];

/** Mapa de cabeçalho → índice 0-based da coluna na aba. */
export type MapaColunas = Record<string, number>;

/** O que lemos de uma linha da planilha para processá-la. */
export interface LinhaEntrada {
  /** Número da linha na planilha (1-based, como o usuário vê). */
  numeroLinha: number;
  /** URL do arquivo da nota (PDF ou XML), lida da coluna de link. */
  linkArquivo: string;
  /** Status atual lido da planilha (para idempotência / pular concluídos). */
  statusAtual?: StatusLinha;
}

/** O que escrevemos de volta na planilha para uma linha. */
export interface LinhaResultado {
  numeroLinha: number;
  status: StatusLinha;
  /** Dados extraídos (presente quando status = CONCLUIDO). */
  nota?: Nota;
  /** De onde os dados vieram (XML/PDF/OCR). */
  fonte?: FonteDados;
  /** Confiança da extração em [0, 1]. */
  confianca?: number;
  /** Mensagem acionável quando status = ERRO (o que falhou). */
  erro?: string;
  /** Timestamp do processamento em ISO 8601. */
  processadoEm: string;
}
