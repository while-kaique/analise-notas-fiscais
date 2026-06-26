/**
 * Parse **robusto** da resposta da IA (modo JSON) para `MapeamentoColunas` (spec §6).
 *
 * A IA é uma borda não confiável: pode devolver JSON cercado por texto, confiança fora
 * de [0,1] ou cabeçalhos inventados. Aqui tudo é validado/narrowed (`unknown` →
 * tipo) e o que não casa é **descartado** em vez de virar lixo no mapa.
 */
import type { MapeamentoColunas, ColunaMapeada } from '../tipos.js';

/** Normaliza um cabeçalho para comparação tolerante (trim + minúsculas). */
function normalizar(cabecalho: string): string {
  return cabecalho.trim().toLowerCase();
}

/**
 * Tenta `JSON.parse`; se falhar, extrai o maior trecho entre a 1ª `{` e a última `}`
 * (cobre respostas cercadas por texto ou ```json). Retorna `null` se não houver objeto.
 */
function lerJsonTolerante(bruto: string): unknown {
  const texto = bruto.trim();
  try {
    return JSON.parse(texto);
  } catch {
    const inicio = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (inicio === -1 || fim <= inicio) return null;
    try {
      return JSON.parse(texto.slice(inicio, fim + 1));
    } catch {
      return null;
    }
  }
}

/** `true` se `v` é um objeto-registro (não array, não null). */
function ehRegistro(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Limita um número a [0,1]; `null` se não for número finito. */
function clampConfianca(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/**
 * Converte a resposta crua da IA em `MapeamentoColunas`, considerando apenas
 * `papeisSolicitados` e cabeçalhos que **existem de fato** em `cabecalhos`.
 *
 * - cabeçalho casado de forma case-insensitive, mas gravado com o texto **canônico**
 *   (como está na planilha) para a escrita posterior bater;
 * - confiança fora de [0,1] é grampeada; entradas sem coluna válida são descartadas;
 * - resposta inválida/sem JSON → mapa vazio (a política então pede confirmação).
 */
export function parsearRespostaMapeamento(
  bruto: string,
  cabecalhos: readonly string[],
  papeisSolicitados: readonly string[],
): MapeamentoColunas {
  const mapa: MapeamentoColunas = {};
  const parsed = lerJsonTolerante(bruto);
  if (!ehRegistro(parsed)) return mapa;

  // cabeçalho normalizado → texto canônico (primeira ocorrência vence).
  const canonico = new Map<string, string>();
  for (const c of cabecalhos) {
    const chave = normalizar(c);
    if (chave !== '' && !canonico.has(chave)) canonico.set(chave, c);
  }

  const solicitados = new Set(papeisSolicitados);
  for (const [papel, valor] of Object.entries(parsed)) {
    if (!solicitados.has(papel)) continue;
    if (!ehRegistro(valor)) continue;

    const colunaBruta = valor['coluna'];
    if (typeof colunaBruta !== 'string') continue;
    const colunaCanonica = canonico.get(normalizar(colunaBruta));
    if (colunaCanonica === undefined) continue; // cabeçalho inventado: descarta

    const confianca = clampConfianca(valor['confianca']);
    if (confianca === null) continue;

    const entrada: ColunaMapeada = { coluna: colunaCanonica, confianca };
    mapa[papel] = entrada;
  }

  return mapa;
}
