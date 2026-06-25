/**
 * Modelo normalizado de uma nota fiscal e o resultado de sua extração.
 *
 * Regras de normalização (ver CLAUDE.md §5):
 * - CNPJ/CPF: somente dígitos (sem pontuação).
 * - Datas: ISO 8601 (`YYYY-MM-DD`).
 * - Valores monetários: inteiro em **centavos** (evita erro de ponto flutuante).
 *   A formatação para exibição (`R$ 1.234,56`) é responsabilidade do frontend.
 */

/** De onde a nota foi extraída — preferência decrescente de confiabilidade. */
export type FonteDados = 'XML' | 'PDF_TEXTO' | 'OCR';

/** Nota fiscal com os campos já normalizados. */
export interface Nota {
  /** CNPJ do emitente, somente dígitos (14 caracteres). */
  cnpjEmitente: string;
  /** Razão social do emitente, quando disponível. */
  razaoSocialEmitente?: string;
  /** CNPJ/CPF do destinatário, somente dígitos, quando disponível. */
  documentoDestinatario?: string;
  /** Data de emissão em ISO 8601 (`YYYY-MM-DD`). */
  dataEmissao: string;
  /** Valor total da nota em centavos (inteiro). */
  valorTotalCentavos: number;
  /** Número da nota, quando disponível. */
  numero?: string;
  /** Série da nota, quando disponível. */
  serie?: string;
  /** Chave de acesso da NF-e (44 dígitos), quando disponível. */
  chaveAcesso?: string;
}

/**
 * Resultado de uma extração: a nota mais metadados de proveniência e confiança.
 * `confianca` em [0, 1]. Use `avisos` para sinalizar baixa confiança em vez de
 * gravar dados duvidosos silenciosamente.
 */
export interface NotaExtraida {
  nota: Nota;
  fonte: FonteDados;
  /** Confiança agregada da extração, de 0 (nenhuma) a 1 (alta). */
  confianca: number;
  /** Mensagens de alerta (ex.: "CNPJ com DV inválido", "valor incerto"). */
  avisos: string[];
}
