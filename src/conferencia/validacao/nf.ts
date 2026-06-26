/**
 * Validação **inicial** da NF (spec §4.3) — função pura, sem I/O.
 *
 * Recebe a linha já cruzada com a base (`LinhaConferencia`) e os campos crus que a IA
 * extraiu do texto da NF (`CamposNfBrutos`), e decide o status. Espelha o nó "Valida NF
 * Inicial" do n8n, com duas mudanças do v2:
 * - normaliza para as unidades internas (centavos / ISO / só dígitos) reusando a **F1**;
 * - classifica o valor em **3 níveis** (`classificarStatus`) em vez de binário.
 *
 * Não faz download nem chama IA — isso é da borda (C4/C3). O caso "sem link" também é
 * resolvido aqui (faz parte da decisão pura) para o orquestrador ficar fino.
 */
import type { CamposNfBrutos, LinhaConferencia, Marca, ResultadoConferencia } from '../tipos.js';
import { normalizarData, somenteDigitos, valorParaCentavos } from '../../parsing/index.js';
import { classificarStatus } from './status.js';

export interface SaidaValidacaoInicial {
  resultado: ResultadoConferencia;
  /**
   * `true` quando o valor não bateu exatamente (mas a NF é legível e o CNPJ casa) e há
   * valor lido: o orquestrador (C5) deve buscar o histórico do cupom e chamar
   * `validarComRetroativo`. Falso nos casos terminais (SEM_NF/NAO_LEGIVEL/CNPJ_DIFERENTE
   * e também APROVADO).
   */
  precisaRetroativo: boolean;
}

/**
 * Converte o `Valor` cru da IA (número ou texto) para centavos inteiros. Números vêm como
 * float com 2 casas (ex.: `100.00`) → arredonda direto; textos passam pelo parser robusto
 * da F1 (lida com `R$`, milhar, vírgula/ponto). Retorna `null` se não der para interpretar.
 */
export function valorNfParaCentavos(valor: number | string | undefined): number | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  }
  return valorParaCentavos(valor);
}

export function validarNfInicial(
  linha: LinhaConferencia,
  campos: CamposNfBrutos | null,
  marca: Pick<Marca, 'cnpjTomador' | 'margemParcialCentavos'>,
): SaidaValidacaoInicial {
  const baseEsperado = linha.valorEsperadoCentavos;
  const comum = {
    cupom: linha.cupom,
    cupomOriginal: linha.cupomOriginal,
    valorEsperadoCentavos: baseEsperado,
    retroativoCentavos: 0,
    valorTotalCentavos: baseEsperado,
  };
  const terminal = (status: ResultadoConferencia['status']): SaidaValidacaoInicial => ({
    resultado: { ...comum, status },
    precisaRetroativo: false,
  });

  // 1. Sem link da NF → SEM_NF.
  if (!linha.linkNf || linha.linkNf.trim() === '') return terminal('SEM_NF');

  // 2. IA não devolveu os campos essenciais → não foi possível ler a NF.
  if (!campos || !campos.CNPJ1 || !campos.CNPJ2 || !campos.Valor) return terminal('NAO_LEGIVEL');

  const valorNfCentavos = valorNfParaCentavos(campos.Valor);
  if (valorNfCentavos === null) return terminal('NAO_LEGIVEL');

  const numeroNf = campos.num_nota?.trim() || undefined;
  const dataNfIso = campos.data_emissao ? normalizarData(campos.data_emissao) ?? undefined : undefined;

  // 3. O CNPJ do tomador (um dos dois lidos) tem que ser o da marca; senão, CNPJ diferente.
  const cnpjMarca = somenteDigitos(marca.cnpjTomador);
  const cnpj1 = somenteDigitos(campos.CNPJ1);
  const cnpj2 = somenteDigitos(campos.CNPJ2);
  const cnpjCasa = cnpjMarca !== '' && (cnpj1 === cnpjMarca || cnpj2 === cnpjMarca);

  if (!cnpjCasa) {
    // Guarda valor/número/data (spec §4.3.3), mas não passa pela comparação de valor.
    const resultado: ResultadoConferencia = { ...comum, status: 'CNPJ_DIFERENTE', valorNfCentavos };
    if (numeroNf !== undefined) resultado.numeroNf = numeroNf;
    if (dataNfIso !== undefined) resultado.dataNfIso = dataNfIso;
    return { resultado, precisaRetroativo: false };
  }

  // 4. Comparação de valor em 3 níveis.
  const status = classificarStatus(valorNfCentavos - baseEsperado, marca.margemParcialCentavos);
  const resultado: ResultadoConferencia = {
    ...comum,
    status,
    cnpjTomador: cnpjMarca,
    valorNfCentavos,
  };
  if (numeroNf !== undefined) resultado.numeroNf = numeroNf;
  if (dataNfIso !== undefined) resultado.dataNfIso = dataNfIso;

  // APROVADO encerra; PARCIAL/NAO_APROVADO ainda podem melhorar via retroativo.
  return { resultado, precisaRetroativo: status !== 'APROVADO' };
}
