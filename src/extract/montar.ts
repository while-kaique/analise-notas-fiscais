/**
 * Montagem do `NotaExtraida` a partir de campos brutos (strings) — comum às três
 * fontes da cascata (XML, texto do PDF, OCR).
 *
 * Aqui a F2 **consome os validadores da F1** (`src/parsing`): normaliza CNPJ/CPF,
 * data e valor para o formato canônico (CLAUDE.md §5) e, em vez de gravar lixo
 * silenciosamente, sinaliza baixa confiança via `avisos`/`confianca`.
 */
import type { FonteDados, NotaExtraida, Nota } from '../types/index.js';
import {
  somenteDigitos,
  validarCnpj,
  validarCpf,
  valorParaCentavos,
  normalizarData,
} from '../parsing/index.js';

/**
 * Campos crus extraídos de uma fonte, antes da normalização. Todos opcionais:
 * cada fonte preenche o que conseguir; o que faltar vira aviso + baixa confiança.
 */
export interface CamposBrutos {
  cnpjEmitente?: string;
  razaoSocialEmitente?: string;
  documentoDestinatario?: string;
  dataEmissao?: string;
  valorTotal?: string;
  numero?: string;
  serie?: string;
  chaveAcesso?: string;
}

/** Confiança-base por fonte, da mais confiável para a menos (CLAUDE.md §1). */
export const PESO_FONTE: Record<FonteDados, number> = {
  XML: 1.0,
  PDF_TEXTO: 0.85,
  OCR: 0.6,
};

interface OpcoesMontagem {
  /**
   * Sobrescreve a confiança-base da fonte (ex.: a confiança reportada pelo motor
   * de OCR). Esperado em [0, 1].
   */
  confiancaFonte?: number;
}

const limitar01 = (n: number): number => Math.max(0, Math.min(1, n));
/** Arredonda para 2 casas, evitando ruído de ponto flutuante na confiança. */
const arredondar2 = (n: number): number => Math.round(n * 100) / 100;

const textoLimpo = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

/**
 * Normaliza os campos brutos para uma `NotaExtraida`. **Nunca lança**: campos
 * ausentes/ inválidos viram avisos e derrubam a confiança, mas a nota é sempre
 * devolvida (a validação estrutural e o status `ERRO` ficam a cargo do pipeline).
 */
export function montarNotaExtraida(
  campos: CamposBrutos,
  fonte: FonteDados,
  opts: OpcoesMontagem = {},
): NotaExtraida {
  const avisos: string[] = [];

  // ── CNPJ do emitente (campo crítico) ──
  const cnpjEmitente = somenteDigitos(campos.cnpjEmitente ?? '');
  let cnpjOk = false;
  if (cnpjEmitente === '') {
    avisos.push('CNPJ do emitente não encontrado.');
  } else if (cnpjEmitente.length !== 14) {
    avisos.push(`CNPJ do emitente com tamanho inesperado (${cnpjEmitente.length} dígitos).`);
  } else if (!validarCnpj(cnpjEmitente)) {
    avisos.push('CNPJ do emitente com dígito verificador inválido.');
  } else {
    cnpjOk = true;
  }

  // ── Data de emissão (campo crítico) ──
  const dataEmissao = normalizarData(campos.dataEmissao ?? '');
  const dataOk = dataEmissao !== null;
  if (!dataOk) {
    avisos.push('Data de emissão ausente ou implausível.');
  }

  // ── Valor total (campo crítico) ──
  const valorTotalCentavos = valorParaCentavos(campos.valorTotal ?? '');
  const valorOk = valorTotalCentavos !== null && valorTotalCentavos >= 0;
  if (valorTotalCentavos === null) {
    avisos.push('Valor total ausente ou não numérico.');
  } else if (valorTotalCentavos < 0) {
    avisos.push('Valor total negativo — provável erro de extração.');
  }

  // ── Documento do destinatário (opcional) ──
  let documentoDestinatario: string | undefined;
  const docDest = somenteDigitos(campos.documentoDestinatario ?? '');
  if (docDest !== '') {
    const destValido =
      (docDest.length === 14 && validarCnpj(docDest)) ||
      (docDest.length === 11 && validarCpf(docDest));
    if (destValido) {
      documentoDestinatario = docDest;
    } else {
      avisos.push('Documento do destinatário ignorado (DV/tamanho inválido).');
    }
  }

  // ── Chave de acesso (opcional, 44 dígitos) ──
  let chaveAcesso: string | undefined;
  const chave = somenteDigitos(campos.chaveAcesso ?? '');
  if (chave !== '') {
    if (chave.length === 44) {
      chaveAcesso = chave;
    } else {
      avisos.push(`Chave de acesso ignorada (esperado 44 dígitos, veio ${chave.length}).`);
    }
  }

  // Monta a Nota respeitando exactOptionalPropertyTypes (só inclui o que existe).
  const razaoSocialEmitente = textoLimpo(campos.razaoSocialEmitente);
  const numero = textoLimpo(campos.numero);
  const serie = textoLimpo(campos.serie);

  const nota: Nota = {
    cnpjEmitente,
    dataEmissao: dataEmissao ?? '',
    valorTotalCentavos: valorOk ? valorTotalCentavos! : 0,
    ...(razaoSocialEmitente !== undefined ? { razaoSocialEmitente } : {}),
    ...(documentoDestinatario !== undefined ? { documentoDestinatario } : {}),
    ...(numero !== undefined ? { numero } : {}),
    ...(serie !== undefined ? { serie } : {}),
    ...(chaveAcesso !== undefined ? { chaveAcesso } : {}),
  };

  const base = limitar01(opts.confiancaFonte ?? PESO_FONTE[fonte]);
  const criticosValidos = [cnpjOk, dataOk, valorOk].filter(Boolean).length;
  const confianca = arredondar2(limitar01(base * (criticosValidos / 3)));

  return { nota, fonte, confianca, avisos };
}
