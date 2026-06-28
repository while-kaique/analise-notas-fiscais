/**
 * Mapeia um {@link ResultadoConferencia} para as células a escrever no formulário,
 * usando os nomes de coluna **configurados na frente** (spec §4.5). Campo ausente →
 * `''` (limpa resíduo → idempotência). Valores monetários em reais pt-BR e datas em
 * `DD/MM/YYYY` (conversão só na escrita — decisão 8; unidades internas seguem em centavos/ISO).
 */
import type { EscritaCelula } from '../contratos.js';
import type { ColunasSaida, ResultadoConferencia, StatusConferencia } from '../tipos.js';
import { ROTULO_STATUS } from '../tipos.js';

/** Rótulo pt-BR → status (para reinterpretar o que já está escrito, ex.: na Soma). */
const STATUS_POR_ROTULO: Readonly<Record<string, StatusConferencia>> = Object.fromEntries(
  Object.entries(ROTULO_STATUS).map(([status, rotulo]) => [rotulo, status as StatusConferencia]),
);

export function statusDeRotulo(rotulo: string): StatusConferencia | undefined {
  return STATUS_POR_ROTULO[rotulo.trim()];
}

/** Centavos → reais em texto pt-BR (`123456` → `"1234,56"`), para `USER_ENTERED`. */
export function centavosParaReaisBr(centavos: number): string {
  return (Math.round(centavos) / 100).toFixed(2).replace('.', ',');
}

/** ISO `YYYY-MM-DD` → `DD/MM/YYYY` (vazio se ausente). */
export function isoParaBr(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function resultadoParaEscritas(
  resultado: ResultadoConferencia,
  colunas: ColunasSaida,
  numeroLinha: number,
): EscritaCelula[] {
  // SEM_BASE (cupom não encontrado na base): só marca o status; sem valores a comparar.
  const semValores = resultado.status === 'SEM_BASE';
  const reais = (centavos: number) => (semValores ? '' : centavosParaReaisBr(centavos));
  const valores: Record<string, string> = {
    [colunas.status]: ROTULO_STATUS[resultado.status],
    [colunas.cnpjTomador]: resultado.cnpjTomador ?? '',
    [colunas.valorNf]:
      resultado.valorNfCentavos != null ? centavosParaReaisBr(resultado.valorNfCentavos) : '',
    [colunas.retroativo]: reais(resultado.retroativoCentavos),
    [colunas.valorEsperado]: reais(resultado.valorEsperadoCentavos),
    [colunas.valorTotal]: reais(resultado.valorTotalCentavos),
    [colunas.dataNf]: isoParaBr(resultado.dataNfIso),
    [colunas.numeroNf]: resultado.numeroNf ?? '',
  };
  return Object.entries(valores).map(([coluna, valor]) => ({ numeroLinha, coluna, valor }));
}
