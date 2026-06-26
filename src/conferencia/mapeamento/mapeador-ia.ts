/**
 * Implementação do contrato `MapeadorColunas` (spec §6) sobre o `ClienteLlm`
 * (GoGroup AI Proxy — implementação concreta em C3; aqui só dependemos da interface,
 * o que mantém este mapeador testável com um cliente fake).
 *
 * Borda fina: monta as mensagens (`prompt.ts`), chama a IA em modo JSON e faz o parse
 * robusto (`parse.ts`). Erros de rede/IA propagam ao chamador; JSON malformado vira
 * mapa vazio (a política a jusante então pede confirmação).
 */
import type { ClienteLlm, EntradaMapeamento, MapeadorColunas, OpcoesLlm } from '../contratos.js';
import type { MapeamentoColunas } from '../tipos.js';
import { montarMensagensMapeamento } from './prompt.js';
import { parsearRespostaMapeamento } from './parse.js';
import { papeisSolicitados } from './papeis.js';

export interface OpcoesMapeador {
  /** Temperatura da chamada (default 0 — mapeamento deve ser determinístico). */
  temperatura?: number;
  /** Sobrescreve o `LLM_MODEL` do cliente para esta tarefa. */
  modelo?: string;
  /** Limite de tokens da resposta. */
  maxTokens?: number;
}

export class MapeadorColunasIa implements MapeadorColunas {
  constructor(
    private readonly llm: ClienteLlm,
    private readonly opts: OpcoesMapeador = {},
  ) {}

  async mapear(entrada: EntradaMapeamento): Promise<MapeamentoColunas> {
    const mensagens = montarMensagensMapeamento(entrada);

    // exactOptionalPropertyTypes: só inclui chaves quando definidas.
    const opcoes: OpcoesLlm = {
      jsonMode: true,
      temperature: this.opts.temperatura ?? 0,
      ...(this.opts.modelo !== undefined ? { model: this.opts.modelo } : {}),
      ...(this.opts.maxTokens !== undefined ? { maxTokens: this.opts.maxTokens } : {}),
    };

    const resposta = await this.llm.chat(mensagens, opcoes);
    return parsearRespostaMapeamento(resposta, entrada.cabecalhos, papeisSolicitados(entrada));
  }
}
