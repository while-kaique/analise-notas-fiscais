/**
 * Parsing/validação — funções **puras**, sem I/O (CLAUDE.md §7).
 *
 * Este módulo contém tanto os **contratos** (tipos das funções, definidos na F0)
 * quanto a **implementação** concreta (F1). São a parte do sistema com mais regras
 * e casos de borda, por isso vêm acompanhadas de muitos testes (`test/parsing.test.ts`).
 *
 * Convenções de saída (CLAUDE.md §5 / spec §"Decisões fechadas"):
 * - valores monetários → inteiro em **centavos**;
 * - datas → ISO 8601 (`YYYY-MM-DD`);
 * - CNPJ/CPF → só dígitos.
 */

// ───────────────────────────── Contratos (tipos) ─────────────────────────────

/** Valida um CNPJ pelos dígitos verificadores. Recebe com ou sem máscara. */
export type ValidarCnpj = (cnpj: string) => boolean;

/** Valida um CPF pelos dígitos verificadores. */
export type ValidarCpf = (cpf: string) => boolean;

/** Remove tudo que não for dígito. */
export type SomenteDigitos = (texto: string) => string;

/**
 * Converte um valor monetário em texto (`"R$ 1.234,56"`, `"1234,56"`, `"1234.56"`)
 * para inteiro em **centavos**. Retorna `null` se não for um valor plausível.
 */
export type ValorParaCentavos = (texto: string) => number | null;

/**
 * Normaliza uma data (`"25/06/2026"`, `"2026-06-25"`, ISO com hora) para
 * `YYYY-MM-DD`. Retorna `null` se a data for inválida ou implausível.
 */
export type NormalizarData = (texto: string) => string | null;

// ──────────────────────────────── Implementação ──────────────────────────────

/** Remove tudo que não for dígito (`"12.345/6"` → `"123456"`). */
export const somenteDigitos: SomenteDigitos = (texto) => texto.replace(/\D/g, '');

/**
 * Calcula um dígito verificador no esquema "módulo 11" usado por CPF/CNPJ:
 * soma `digito[i] * peso[i]`, tira o resto por 11; resto < 2 → DV 0, senão 11 - resto.
 */
function digitoVerificadorModulo11(digitos: string, pesos: readonly number[]): number {
  let soma = 0;
  for (let i = 0; i < pesos.length; i++) {
    // pesos.length casa com o nº de dígitos considerados; índice sempre válido.
    soma += Number(digitos[i]) * pesos[i]!;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** `true` se a string for um único dígito repetido (ex.: `"00000000000"`). */
function todosDigitosIguais(digitos: string): boolean {
  return digitos.length > 0 && /^(\d)\1*$/.test(digitos);
}

const PESOS_CPF_DV1 = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CPF_DV2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/**
 * Valida um CPF pelos dois dígitos verificadores. Aceita com ou sem máscara.
 * Rejeita comprimento ≠ 11 e sequências de dígito repetido (entrada inválida comum).
 */
export const validarCpf: ValidarCpf = (cpf) => {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || todosDigitosIguais(d)) return false;

  const dv1 = digitoVerificadorModulo11(d, PESOS_CPF_DV1);
  const dv2 = digitoVerificadorModulo11(d, PESOS_CPF_DV2);
  return dv1 === Number(d[9]) && dv2 === Number(d[10]);
};

const PESOS_CNPJ_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CNPJ_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/**
 * Valida um CNPJ pelos dois dígitos verificadores. Aceita com ou sem máscara.
 * Rejeita comprimento ≠ 14 e sequências de dígito repetido.
 */
export const validarCnpj: ValidarCnpj = (cnpj) => {
  const d = somenteDigitos(cnpj);
  if (d.length !== 14 || todosDigitosIguais(d)) return false;

  const dv1 = digitoVerificadorModulo11(d, PESOS_CNPJ_DV1);
  const dv2 = digitoVerificadorModulo11(d, PESOS_CNPJ_DV2);
  return dv1 === Number(d[12]) && dv2 === Number(d[13]);
};

/**
 * Converte texto monetário em inteiro de centavos. Lida com:
 * - símbolo/letras de moeda e espaços (`"R$ 1.234,56"`, `"1234,56 BRL"`);
 * - separador decimal `,` ou `.` (o **último** separador é o decimal quando há os dois);
 * - separador de milhar (removido);
 * - sinal negativo (`-` à frente ou parênteses contábeis `(...)`).
 *
 * Heurística para um único separador: aparecendo mais de uma vez, ou seguido de
 * exatamente 3 dígitos, é tratado como **milhar** (`"1.234"` → 1234,00); caso
 * contrário é decimal (`"12,5"` → 12,50). Retorna `null` quando não há dígito algum.
 */
export const valorParaCentavos: ValorParaCentavos = (texto) => {
  if (typeof texto !== 'string') return null;
  const original = texto.trim();
  if (original === '') return null;

  const negativo = original.startsWith('-') || /^\(.*\)$/.test(original);

  // Mantém apenas dígitos e os separadores; descarta "R$", letras, espaços, sinal.
  let s = original.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;

  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');

  let inteiroStr = s;
  let decimalStr = '';

  if (temVirgula && temPonto) {
    // O separador decimal é o que aparece por último; o outro é milhar.
    const sepDecimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const sepMilhar = sepDecimal === ',' ? '.' : ',';
    s = s.split(sepMilhar).join('');
    const partes = s.split(sepDecimal);
    inteiroStr = partes[0] ?? '';
    decimalStr = partes[1] ?? '';
  } else if (temVirgula || temPonto) {
    const sep = temVirgula ? ',' : '.';
    const partes = s.split(sep);
    const ultima = partes[partes.length - 1] ?? '';
    if (partes.length > 2 || ultima.length === 3) {
      // Múltiplas ocorrências, ou 3 casas após um único separador → milhar.
      inteiroStr = partes.join('');
      decimalStr = '';
    } else {
      inteiroStr = partes[0] ?? '';
      decimalStr = ultima;
    }
  }

  inteiroStr = inteiroStr.replace(/\D/g, '') || '0';
  decimalStr = decimalStr.replace(/\D/g, '');

  const numero = Number(`${inteiroStr}.${decimalStr || '0'}`);
  if (!Number.isFinite(numero)) return null;

  const centavos = Math.round(numero * 100);
  return negativo ? -centavos : centavos;
};

const ANO_MIN = 2000;
const ANO_MAX = 2100;

/** `true` se o ano for bissexto. */
function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** Valida se (ano, mês, dia) formam uma data de calendário real. */
function dataEhValida(ano: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12) return false;
  const diasNoMes = [31, ehBissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // mes ∈ [1,12] garante índice válido.
  return dia >= 1 && dia <= diasNoMes[mes - 1]!;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Normaliza uma data textual para `YYYY-MM-DD`. Aceita:
 * - ISO (`"2026-06-25"`, `"2026-06-25T10:30:00Z"`, `"2026/06/25"`);
 * - BR (`"25/06/2026"`, `"25-06-2026"`, `"25.06.2026"`, com hora opcional ao final);
 * - ano de 2 dígitos no formato BR (`"25/06/26"` → 2026), assumindo século 2000.
 *
 * Retorna `null` se a data não for um calendário real ou se o ano cair fora da
 * janela plausível para uma nota fiscal (`2000`–`2100`).
 */
export const normalizarData: NormalizarData = (texto) => {
  if (typeof texto !== 'string') return null;
  const s = texto.trim();
  if (s === '') return null;

  let ano: number | undefined;
  let mes: number | undefined;
  let dia: number | undefined;

  // ISO: YYYY-MM-DD ou YYYY/MM/DD, com hora opcional após "T" ou espaço.
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (iso) {
    ano = Number(iso[1]);
    mes = Number(iso[2]);
    dia = Number(iso[3]);
  } else {
    // BR: DD/MM/YYYY (ou - .), ano de 2 ou 4 dígitos, com hora opcional.
    const br = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T ].*)?$/.exec(s);
    if (br) {
      dia = Number(br[1]);
      mes = Number(br[2]);
      const anoBruto = Number(br[3]);
      ano = br[3]!.length === 2 ? 2000 + anoBruto : anoBruto;
    }
  }

  if (ano === undefined || mes === undefined || dia === undefined) return null;
  if (ano < ANO_MIN || ano > ANO_MAX) return null;
  if (!dataEhValida(ano, mes, dia)) return null;

  return `${ano}-${pad2(mes)}-${pad2(dia)}`;
};
