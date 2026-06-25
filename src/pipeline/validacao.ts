import type { Nota } from '../types/index.js';

/**
 * Verificação **estrutural** da nota já normalizada pelo extractor (F2), antes
 * de marcar a linha como CONCLUIDO. É uma rede de segurança barata e sem I/O —
 * a validação fiscal forte (DV de CNPJ/CPF, plausibilidade de valor/data) é
 * responsabilidade da F1/F2, que alimentam `NotaExtraida.avisos`/`confianca`.
 *
 * Mantida pura e local de propósito: a F5 não depende das funções concretas da
 * F1 (que evolui em paralelo) — só dos contratos da F0 (CLAUDE.md §10).
 *
 * Retorna `null` quando a nota passa, ou uma mensagem acionável do que falhou.
 */
export function validarNotaExtraida(nota: Nota): string | null {
  if (!/^\d{14}$/.test(nota.cnpjEmitente)) {
    return 'CNPJ do emitente ausente ou inválido (esperado 14 dígitos).';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nota.dataEmissao)) {
    return 'Data de emissão ausente ou fora do formato ISO 8601 (YYYY-MM-DD).';
  }
  if (!Number.isInteger(nota.valorTotalCentavos) || nota.valorTotalCentavos < 0) {
    return 'Valor total inválido (esperado inteiro não negativo, em centavos).';
  }
  return null;
}
