/**
 * Validação com **retroativo** (spec §4.4) — função pura, sem I/O.
 *
 * Quando o valor da NF não bate com o esperado do mês, o influencer pode ter mandado
 * uma única nota cobrindo meses anteriores. Acumula-se o esperado dos meses passados
 * (do mais recente para o mais antigo) até o valor da NF bater, **parando** ao encontrar
 * um mês cujo status é bloqueante (já pago/lançado — spec §4.4).
 *
 * Diferença para o n8n: lá o resultado era binário (só "bateu exato"). Aqui rastreamos o
 * **menor** `|acumulado − valorNf|` alcançado e o classificamos em 3 níveis
 * (`classificarStatus`), então uma soma que chega "perto" vira PARCIAL em vez de NAO_APROVADO.
 * Como o ponto de partida (sem nenhum mês somado) também entra na disputa do menor diff, o
 * retroativo **nunca piora** a classificação inicial — ela fica como fallback natural.
 */
import type { EntradaHistorico } from '../tipos.js';
import { classificarStatus, type StatusAprovacao } from './status.js';

/**
 * Converte `MM/YYYY` num inteiro comparável (`ano*12 + mes`), para ordenar/filtrar meses.
 * Retorna `null` quando o texto não é um `MM/YYYY` plausível (mês 1–12). Aceita 1–2 dígitos
 * no mês e espaços ao redor; ignora qualquer coisa após o ano.
 */
export function mesParaNumero(mesAno: string): number | null {
  if (typeof mesAno !== 'string') return null;
  const partes = mesAno.trim().split('/');
  if (partes.length !== 2) return null;
  const mes = Number(partes[0]);
  const ano = Number(partes[1]);
  if (!Number.isInteger(mes) || !Number.isInteger(ano)) return null;
  if (mes < 1 || mes > 12) return null;
  return ano * 12 + mes;
}

export interface EntradaRetroativo {
  /** Valor lido da NF (IA), em centavos. */
  valorNfCentavos: number;
  /** Valor esperado da base para o mês alvo, em centavos. */
  valorBaseCentavos: number;
  /** Mês/Ano alvo (`MM/YYYY`) — só meses **anteriores** a ele entram na acumulação. */
  mesAno: string;
  /** Histórico do cupom na base (todas as entradas; filtra/ordena aqui dentro). */
  historico: readonly EntradaHistorico[];
  /** Status que, ao serem encontrados, **param** a acumulação (config da marca). */
  statusBloqueantes: readonly string[];
  /** Margem (centavos) da faixa "Parcial". */
  margemParcialCentavos: number;
}

export interface ResultadoRetroativo {
  status: StatusAprovacao;
  /** Soma dos meses retroativos usados (centavos). */
  retroativoCentavos: number;
  /** Esperado acumulado no ponto de menor diferença (= base + retroativo). */
  valorEsperadoCentavos: number;
  /** Base + retroativo (espelha `ValorTotal_*` do n8n). */
  valorTotalCentavos: number;
  /** Meses usados, do mais recente para o mais antigo (`MM/YYYY`). */
  mesesRetroativos: readonly string[];
}

export function validarComRetroativo(entrada: EntradaRetroativo): ResultadoRetroativo {
  const { valorNfCentavos, valorBaseCentavos, mesAno, historico, statusBloqueantes, margemParcialCentavos } = entrada;

  const mesAlvoNum = mesParaNumero(mesAno);
  const bloqueantes = new Set(statusBloqueantes.map((s) => s.trim()));

  // Remove duplicatas (Mês/Ano + valor), mantém só meses anteriores ao alvo, do recente p/ o antigo.
  const vistos = new Set<string>();
  const anteriores = historico
    .filter((h) => {
      const chave = `${h.mesAno}|${h.valorCentavos}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .map((h) => ({ ...h, mesNum: mesParaNumero(h.mesAno) }))
    .filter((h): h is EntradaHistorico & { mesNum: number } =>
      h.mesNum !== null && mesAlvoNum !== null && h.mesNum < mesAlvoNum,
    )
    .sort((a, b) => b.mesNum - a.mesNum);

  // Estado do melhor ponto encontrado; começa sem nenhum mês somado (só a base).
  let acumulado = valorBaseCentavos;
  let retroativo = 0;
  const meses: string[] = [];
  let melhor = {
    diff: Math.abs(valorNfCentavos - valorBaseCentavos),
    retroativo: 0,
    acumulado: valorBaseCentavos,
    meses: [] as string[],
  };

  for (const h of anteriores) {
    if (bloqueantes.has(h.status.trim())) break;

    acumulado += h.valorCentavos;
    retroativo += h.valorCentavos;
    meses.push(h.mesAno);

    const diff = Math.abs(valorNfCentavos - acumulado);
    if (diff < melhor.diff) {
      melhor = { diff, retroativo, acumulado, meses: [...meses] };
    }
    if (diff === 0) break; // exato — não dá para melhorar
  }

  return {
    status: classificarStatus(melhor.diff, margemParcialCentavos),
    retroativoCentavos: melhor.retroativo,
    valorEsperadoCentavos: melhor.acumulado,
    valorTotalCentavos: valorBaseCentavos + melhor.retroativo,
    mesesRetroativos: melhor.meses,
  };
}
