/**
 * `ExtratorCampos` (C0) — texto do OCR → campos crus da NF, via **AI Proxy** em modo
 * JSON. O prompt é **verbatim do n8n** (spec §5.4) para manter paridade com o fluxo
 * que está em produção; o que muda vs. n8n é só a infra (cliente `fetch`, modo JSON
 * explícito, modelo via `LLM_MODEL`).
 *
 * Saída = `CamposNfBrutos` (cru). A normalização para o formato canônico (centavos,
 * ISO, só dígitos) e a validação fiscal (DV de CNPJ, classificação de status) são da
 * **C1** (validação) — aqui não acoplamos aos validadores da F1, igual ao limite que
 * a F5 manteve. Campos ausentes voltam ausentes (a IA "não conseguiu ler" vira
 * `NAO_LEGIVEL` na C1, spec §4.3).
 */
import type { ClienteLlm, ExtratorCampos } from '../contratos.js';
import type { CamposNfBrutos } from '../tipos.js';

/**
 * Prompt **system** verbatim do n8n (spec §5.4 — manter paridade). O texto do OCR
 * vai como mensagem **user**. NÃO editar sem revisar a paridade com `fluxos_n8n/`.
 */
export const PROMPT_SISTEMA_NF = `Você vai receber um texto que é uma Nota Fiscal. Extraia:
- CNPJ do Emissor/Prestador
- Valor Líquido da nota (número float, ex: 100.00, sem R$)
- CNPJ do Tomador do Serviço
- Data de emissão (formato DD/MM/YYYY)
- Número da nota fiscal

Retorne JSON:
{
  "CNPJ1": "CNPJ DO EMISSOR",
  "Valor": 100.00 (sempre com duas casas decimais),
  "CNPJ2": "CNPJ DO TOMADOR",
  "data_emissao": "DD/MM/YYYY",
  "num_nota": "NÚMERO"
}`;

/**
 * Cria um `ExtratorCampos` sobre um `ClienteLlm`. Usa `temperature: 0` (extração é
 * determinística — melhor que o n8n, que não fixava temperatura) e modo JSON.
 * **Lança** (mensagem acionável) se o transporte falhar ou a resposta não for JSON —
 * o pipeline (C5) isola a linha (`ERRO`/`NAO_LEGIVEL`) sem derrubar o lote (§3).
 */
export function criarExtratorCampos(cliente: ClienteLlm): ExtratorCampos {
  return {
    async extrair(textoNf: string): Promise<CamposNfBrutos> {
      const conteudo = await cliente.chat(
        [
          { role: 'system', content: PROMPT_SISTEMA_NF },
          { role: 'user', content: textoNf },
        ],
        { jsonMode: true, temperature: 0 },
      );
      return parseCamposNf(conteudo);
    },
  };
}

/**
 * Faz o parse defensivo do JSON da IA em `CamposNfBrutos`: tolera cercas de código
 * (```json), texto ao redor e campos extras (mapeia só os 5 esperados). Função pura.
 * Lança se nada parseável for encontrado.
 */
export function parseCamposNf(conteudo: string): CamposNfBrutos {
  const obj = extrairJson(conteudo);
  const r: Record<string, unknown> =
    obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};

  const campos: CamposNfBrutos = {};
  const cnpj1 = comoTexto(r['CNPJ1']);
  if (cnpj1 !== undefined) campos.CNPJ1 = cnpj1;
  const cnpj2 = comoTexto(r['CNPJ2']);
  if (cnpj2 !== undefined) campos.CNPJ2 = cnpj2;
  const valor = comoValor(r['Valor']);
  if (valor !== undefined) campos.Valor = valor;
  const data = comoTexto(r['data_emissao']);
  if (data !== undefined) campos.data_emissao = data;
  const num = comoTexto(r['num_nota']);
  if (num !== undefined) campos.num_nota = num;
  return campos;
}

/** Extrai o objeto JSON de uma resposta da IA, tolerando cercas/texto ao redor. */
function extrairJson(conteudo: string): unknown {
  const limpo = conteudo
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(limpo);
  } catch {
    // Tenta recortar o primeiro objeto { ... } embutido em texto.
  }
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio >= 0 && fim > inicio) {
    try {
      return JSON.parse(limpo.slice(inicio, fim + 1));
    } catch {
      // cai no erro abaixo
    }
  }
  throw new Error('IA retornou conteúdo que não é JSON válido.');
}

/** Normaliza um valor cru em string não vazia (ou número → string), senão `undefined`. */
function comoTexto(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : t;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/** O campo `Valor` pode vir como número ou string (a IA "às vezes" devolve string). */
function comoValor(v: unknown): number | string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : t;
  }
  return undefined;
}
