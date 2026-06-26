/**
 * Tipos do **pipeline de conferência** (v2 · fatia C5). A orquestração depende só dos
 * contratos (C0) + das funções puras (C1) + das implementações injetadas (C2/C3/C4),
 * por isso é testável com fakes.
 */
import type { BaixadorNf, LeitorPlanilha, MapeadorColunas } from '../contratos.js';
import type { CacheMapeamento } from '../mapeamento/index.js';
import type { ExtracaoNf } from '../extracao/index.js';
import type { LinhaConferencia, ResultadoConferencia, TipoFrente } from '../tipos.js';

/** Uma linha do formulário pronta para processar + a linha física onde gravar. */
export interface LinhaParaProcessar {
  linha: LinhaConferencia;
  /** Número da linha no formulário (1-based) onde a saída será escrita. */
  numeroLinha: number;
}

/** Dependências injetadas no pipeline (todas atrás de interface). */
export interface DepsPipeline {
  /** I/O de planilha (base + formulário). */
  leitor: LeitorPlanilha;
  /** Download da NF (Drive — C4). */
  baixador: BaixadorNf;
  /** Extração de campos com cache por hash (OCR + IA — C3). */
  extracao: ExtracaoNf;
  /** Mapeador de colunas por IA (C2). */
  mapeador: MapeadorColunas;
  /** Cache do mapa de colunas por perfil/frente (C2/C0). */
  cacheMapa: CacheMapeamento;
}

export interface OpcoesProcessamento {
  /** Máximo de cupons processados por execução (lote do cron). Default 50. */
  batchLimit?: number;
}

/** Resultado do processamento de uma frente. */
export interface ResultadoFrente {
  frente: TipoFrente;
  resultados: ResultadoConferencia[];
  /** A IA não teve confiança suficiente no mapeamento → a UI (C6) deve confirmar. */
  precisaConfirmarMapeamento: boolean;
  /** De onde veio o mapa de colunas (quando aplicável). */
  origemMapa?: 'cache' | 'ia';
}

/** Resumo do processamento de um perfil (todas as frentes, na ordem). */
export interface ResumoPerfil {
  perfilId: string;
  mesAlvo: string;
  frentes: ResultadoFrente[];
}

/** Limite padrão de cupons por execução (vira lote do cron na C6). */
export const BATCH_PADRAO = 50;
