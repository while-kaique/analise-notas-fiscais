/**
 * Extração a partir de **texto livre** — usada tanto para a camada de texto do
 * PDF (DANFE com texto) quanto para a saída do OCR (PDF escaneado).
 *
 * É a parte heurística da F2: o texto não tem estrutura garantida, então
 * busca-se por rótulos conhecidos da DANFE e, na falta deles, por padrões
 * (CNPJ com DV válido, datas, valores monetários). Função **pura e testável**
 * (CLAUDE.md §7); a normalização/validação fica em `montar.ts`.
 */
import { somenteDigitos, validarCnpj } from '../parsing/index.js';
import type { CamposBrutos } from './montar.js';

/** CNPJ com ou sem máscara (`14.200.166/0001-87` ou `14200166000187`). */
const RE_CNPJ = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g;
/** CPF com ou sem máscara. */
const RE_CPF = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g;
/** Data dd/mm/aaaa (ou `-` `.`), ano de 2 ou 4 dígitos. Sem `/g`: só busca única. */
const RE_DATA = /\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/;
/** Valor monetário brasileiro: `1.234.567,89` / `1234,56` (vírgula decimal). */
const RE_MOEDA = /\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2}/;
/** Chave de acesso: 44 dígitos, possivelmente em grupos separados por espaço. */
const RE_CHAVE = /(?:\d[\s.]?){43}\d/g;

/** Captura o primeiro valor que casa `valor` logo após algum dos `rotulos`. */
function aposRotulo(texto: string, rotulos: readonly RegExp[], valor: RegExp): string | undefined {
  for (const rotulo of rotulos) {
    const m = rotulo.exec(texto);
    if (!m) continue;
    const inicio = m.index + m[0].length;
    const janela = texto.slice(inicio, inicio + 80);
    const v = valor.exec(janela);
    if (v) return v[0];
  }
  return undefined;
}

/** Extrai a chave de acesso (44 dígitos) e devolve [chave, textoSemChave]. */
function extrairChave(texto: string): [string | undefined, string] {
  for (const bruto of texto.match(RE_CHAVE) ?? []) {
    const digitos = somenteDigitos(bruto);
    if (digitos.length === 44) {
      // Remove a ocorrência para não confundir a busca de CNPJ (44 dígitos contêm
      // sub-sequências de 14).
      return [digitos, texto.replace(bruto, ' ')];
    }
  }
  return [undefined, texto];
}

/** CNPJs com DV válido, na ordem de aparição e sem repetição. */
function cnpjsValidos(texto: string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const bruto of texto.match(RE_CNPJ) ?? []) {
    const d = somenteDigitos(bruto);
    if (d.length === 14 && validarCnpj(d) && !vistos.has(d)) {
      vistos.add(d);
      out.push(d);
    }
  }
  return out;
}

export function extrairCamposDeTexto(textoEntrada: string): CamposBrutos {
  const [chaveAcesso, texto] = extrairChave(textoEntrada);

  // CNPJ do emitente = 1º válido; destinatário = 2º válido (se houver).
  const cnpjs = cnpjsValidos(texto);
  const cnpjEmitente = cnpjs[0];
  let documentoDestinatario: string | undefined = cnpjs[1];

  // Se não houver 2º CNPJ, tenta um CPF para o destinatário.
  if (documentoDestinatario === undefined) {
    const cpf = (texto.match(RE_CPF) ?? [])
      .map((c) => somenteDigitos(c))
      .find((d) => d.length === 11);
    if (cpf !== undefined) documentoDestinatario = cpf;
  }

  // Data de emissão: preferir rótulo; senão a 1ª data plausível do texto.
  const dataEmissao =
    aposRotulo(texto, [/data\s+(?:de\s+)?emiss[ãa]o/i, /emiss[ãa]o/i], RE_DATA) ??
    (RE_DATA.exec(texto)?.[0]);

  // Valor total: preferir rótulos da DANFE; senão o maior valor encontrado.
  const valorTotal =
    aposRotulo(
      texto,
      [
        /valor\s+total\s+da\s+nota/i,
        /valor\s+total\s+da\s+nf/i,
        /valor\s+l[ií]quido/i,
        /valor\s+total/i,
      ],
      RE_MOEDA,
    ) ?? maiorValor(texto);

  return {
    ...(cnpjEmitente !== undefined ? { cnpjEmitente } : {}),
    ...(documentoDestinatario !== undefined ? { documentoDestinatario } : {}),
    ...(dataEmissao !== undefined ? { dataEmissao } : {}),
    ...(valorTotal !== undefined ? { valorTotal } : {}),
    ...(chaveAcesso !== undefined ? { chaveAcesso } : {}),
  };
}

/** Maior token monetário do texto — fallback quando nenhum rótulo casa. */
function maiorValor(texto: string): string | undefined {
  const re = new RegExp(RE_MOEDA.source, 'g');
  let maior: string | undefined;
  let maiorNum = -1;
  for (const m of texto.match(re) ?? []) {
    const num = Number(somenteDigitos(m.replace(/,\d{2}$/, '')) + '.' + m.slice(-2));
    if (Number.isFinite(num) && num > maiorNum) {
      maiorNum = num;
      maior = m;
    }
  }
  return maior;
}
