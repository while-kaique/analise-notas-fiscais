import type { LinhaEntrada, LinhaResultado } from '../types/index.js';
import type { DependenciasPipeline, ProcessarLinha } from './index.js';
import { agora } from './concorrencia.js';
import { validarNotaExtraida } from './validacao.js';

/** Mensagem de erro acionável (o que falhou + onde), sem expor conteúdo fiscal. */
function descreverErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  if (typeof erro === 'string') return erro;
  return 'erro desconhecido';
}

/**
 * Processa **uma** linha: baixa → extrai → valida → devolve o resultado.
 *
 * Falha isolada (CLAUDE.md §3): NUNCA lança. Qualquer erro (link morto, PDF
 * quebrado, extração ilegível, nota incompleta) vira um `LinhaResultado` com
 * status ERRO e mensagem acionável — quem orquestra o lote segue em frente.
 */
export const processarLinha: ProcessarLinha = async (
  linha: LinhaEntrada,
  deps: DependenciasPipeline,
): Promise<LinhaResultado> => {
  const processadoEm = agora();
  try {
    const arquivo = await deps.fetcher.baixar(linha.linkArquivo);
    const extraida = await deps.extractor.extrair(arquivo);

    const problema = validarNotaExtraida(extraida.nota);
    if (problema !== null) {
      return {
        numeroLinha: linha.numeroLinha,
        status: 'ERRO',
        fonte: extraida.fonte,
        confianca: extraida.confianca,
        erro: problema,
        processadoEm,
      };
    }

    return {
      numeroLinha: linha.numeroLinha,
      status: 'CONCLUIDO',
      nota: extraida.nota,
      fonte: extraida.fonte,
      confianca: extraida.confianca,
      processadoEm,
    };
  } catch (erro) {
    return {
      numeroLinha: linha.numeroLinha,
      status: 'ERRO',
      erro: `Falha ao processar a linha ${linha.numeroLinha}: ${descreverErro(erro)}`,
      processadoEm,
    };
  }
};
