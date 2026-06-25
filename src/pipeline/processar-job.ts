import type { LinhaResultado } from '../types/index.js';
import { COLUNAS } from '../types/index.js';
import type { ProcessarJob, OnProgresso } from './index.js';
import { processarLinha } from './processar-linha.js';
import { processarComConcorrencia, agora } from './concorrencia.js';

/** Concorrência padrão de linhas quando o chamador não especifica. */
export const CONCORRENCIA_PADRAO = 4;

const semProgresso: OnProgresso = () => {};

/**
 * Orquestra o job inteiro (CLAUDE.md §3/§4):
 *  1. lê a planilha e garante as colunas de resultado (cria as que faltarem);
 *  2. **idempotência** — pula as linhas já CONCLUIDO (não rebaixa nem reextrai);
 *  3. marca as linhas a processar como PROCESSANDO **antes** de começar
 *     (escrita em lote) — evita corrida em reprocessos;
 *  4. processa com **concorrência limitada**, com **falha isolada** por linha;
 *  5. escreve os resultados finais em lote (`batchUpdate`, nunca célula a célula).
 *
 * `onProgresso` é chamado para cada linha (status inicial e final), alimentando
 * a devolutiva na tela (F6) — inclusive as já concluídas, que entram no total.
 */
export const processarJob: ProcessarJob = async (job, deps, opts = {}) => {
  const concorrencia = Math.max(1, opts.concorrencia ?? CONCORRENCIA_PADRAO);
  const onProgresso = opts.onProgresso ?? semProgresso;

  const leitura = await deps.sheets.lerLinhas(job.spreadsheetId, job.aba);
  await deps.sheets.garantirColunas(
    job.spreadsheetId,
    Object.values(COLUNAS),
    job.aba,
  );

  // Idempotência: o que já está CONCLUIDO não reprocessa, mas conta no total.
  const aProcessar = leitura.linhas.filter((l) => l.statusAtual !== 'CONCLUIDO');
  for (const l of leitura.linhas) {
    if (l.statusAtual === 'CONCLUIDO') {
      onProgresso({
        numeroLinha: l.numeroLinha,
        status: 'CONCLUIDO',
        processadoEm: agora(),
      });
    }
  }

  if (aProcessar.length === 0) return;

  // Marca PROCESSANDO antes de iniciar (anti-corrida) — escrita em lote.
  const marcadores: LinhaResultado[] = aProcessar.map((l) => ({
    numeroLinha: l.numeroLinha,
    status: 'PROCESSANDO' as const,
    processadoEm: agora(),
  }));
  await deps.sheets.escreverResultados(job.spreadsheetId, marcadores, job.aba);
  for (const m of marcadores) onProgresso(m);

  // Processa com concorrência limitada; `processarLinha` não lança (falha isolada).
  const resultados = await processarComConcorrencia(
    aProcessar,
    concorrencia,
    async (linha) => {
      const resultado = await processarLinha(linha, deps);
      onProgresso(resultado);
      return resultado;
    },
  );

  // Resultado final em lote.
  await deps.sheets.escreverResultados(job.spreadsheetId, resultados, job.aba);
};
