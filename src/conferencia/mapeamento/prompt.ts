/**
 * Montagem **pura** das mensagens enviadas ao AI Proxy para mapear o cabeçalho de um
 * formulário nos papéis conhecidos (spec §6). Sem I/O — a chamada de rede está no
 * `MapeadorColunasIa`. Manter determinístico (testável).
 */
import type { EntradaMapeamento, MensagemLlm } from '../contratos.js';
import { descricaoPapel, papeisSolicitados } from './papeis.js';

/** Quantos valores de exemplo, no máximo, mostrar por coluna (spec §6: 2–3). */
const MAX_EXEMPLOS_POR_COLUNA = 3;

const SISTEMA =
  'Você mapeia as colunas de uma planilha de respostas de formulário para PAPÉIS conhecidos.\n' +
  'Receberá: (1) a lista de papéis desejados com a descrição de cada um; (2) os cabeçalhos ' +
  'reais da planilha, cada um com alguns valores de exemplo.\n' +
  'Para cada papel, escolha o cabeçalho que melhor o representa e dê uma confiança de 0 a 1.\n' +
  'Regras:\n' +
  '- Use o texto EXATO do cabeçalho (copie sem alterar acentos, maiúsculas ou espaços).\n' +
  '- Cada cabeçalho serve a no máximo um papel; não invente cabeçalhos.\n' +
  '- Se nenhum cabeçalho servir a um papel, OMITA esse papel (não chute).\n' +
  '- confianca alta (≥0.8) só quando o casamento for claro pelos exemplos e pelo nome.\n' +
  'Responda APENAS com um JSON no formato: ' +
  '{ "<papel>": { "coluna": "<cabeçalho exato>", "confianca": 0.0 } }';

/** Bloco textual de um cabeçalho com seus exemplos (entre aspas, truncados). */
function linhaCabecalho(
  cabecalho: string,
  exemplos: Readonly<Record<string, readonly string[]>> | undefined,
): string {
  const valores = (exemplos?.[cabecalho] ?? [])
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .slice(0, MAX_EXEMPLOS_POR_COLUNA)
    .map((v) => (v.length > 80 ? `${v.slice(0, 77)}...` : v))
    .map((v) => `"${v}"`);
  const amostra = valores.length > 0 ? valores.join(', ') : '(sem exemplos)';
  return `- ${cabecalho} → exemplos: ${amostra}`;
}

/**
 * Monta as mensagens `system` + `user` do mapeamento. A `user` lista os papéis pedidos
 * e os cabeçalhos com exemplos; espera-se resposta em **modo JSON**.
 */
export function montarMensagensMapeamento(entrada: EntradaMapeamento): MensagemLlm[] {
  const papeis = papeisSolicitados(entrada);
  const blocoPapeis = papeis.map((p) => `- ${p}: ${descricaoPapel(p)}`).join('\n');
  const blocoCabecalhos = entrada.cabecalhos
    .map((c) => linhaCabecalho(c, entrada.exemplos))
    .join('\n');

  const user =
    `PAPÉIS DESEJADOS:\n${blocoPapeis}\n\n` +
    `CABEÇALHOS DA PLANILHA (com exemplos):\n${blocoCabecalhos}\n\n` +
    'Devolva o JSON do mapeamento.';

  return [
    { role: 'system', content: SISTEMA },
    { role: 'user', content: user },
  ];
}
