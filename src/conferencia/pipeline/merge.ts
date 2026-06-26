/**
 * Entrada e **merge por cupom** (spec §4.1) — funções puras, sem I/O.
 *
 * Espelha os nós do n8n "Filtra Base/Formulário", "Limpa Campos", "Merge por Cupom" e
 * "Agrupa por Cupom": normaliza o cupom, filtra inválidos/exclusões, cruza cada resposta
 * do formulário com o valor esperado da base e mantém a 1ª resposta de cada cupom. A
 * **idempotência** (pular cupons já processados) é feita aqui pela coluna de status.
 */
import type { RegistroPlanilha } from '../contratos.js';
import type {
  EntradaHistorico,
  Frente,
  LinhaConferencia,
  MapeamentoColunas,
  PapelLinkNf,
} from '../tipos.js';
import type { LinhaParaProcessar } from './tipos.js';
import { valorParaCentavos } from '../../parsing/index.js';

/** Cabeçalhos **fixos** da planilha-base (CONTROLE). Estável por marca (decisão 4). */
export const COLUNAS_BASE = {
  cupom: 'Cupom',
  valor: 'Valor NF',
  status: 'Status',
  mesAno: 'Mês/Ano',
  id: 'ID',
} as const;

/** Normalização do cupom usada nos dois lados do merge (n8n: `toUpperCase().replaceAll(' ','')`). */
export function normalizarCupom(cupom: string): string {
  return cupom.toUpperCase().replace(/ /g, '');
}

/** `papelLinkNf` da frente → papel de coluna que a IA mapeia no formulário. */
const PAPEL_LINK: Readonly<Record<PapelLinkNf, 'linkNf_influencer' | 'linkNf_assessoria' | 'linkNf_unica'>> = {
  influencer: 'linkNf_influencer',
  assessoria: 'linkNf_assessoria',
  unica: 'linkNf_unica',
};

/** Valor da base → centavos; `#`/vazio/ilegível → 0 (embaixador marca `#` no histórico). */
function valorBaseCentavos(texto: string): number {
  const t = (texto ?? '').trim();
  if (t === '' || t.startsWith('#')) return 0;
  return valorParaCentavos(t) ?? 0;
}

export interface IndiceBase {
  /** Esperado do **mês alvo** por cupom (linha sem `#` no valor). */
  esperadoPorCupom: Map<string, { valorCentavos: number; mesAno: string; id: string }>;
  /** Histórico **completo** do cupom (todos os meses) para o retroativo. */
  historicoPorCupom: Map<string, EntradaHistorico[]>;
}

/**
 * Indexa a base: monta o esperado do mês alvo e o histórico por cupom em **uma** leitura
 * (otimização vs n8n, que relia a base por cupom — §7). Pula cupons vazios ou com `#`.
 */
export function indexarBase(
  registros: readonly RegistroPlanilha[],
  mesAlvo: string,
): IndiceBase {
  const esperadoPorCupom = new Map<string, { valorCentavos: number; mesAno: string; id: string }>();
  const historicoPorCupom = new Map<string, EntradaHistorico[]>();

  for (const r of registros) {
    const cupomBruto = (r.valores[COLUNAS_BASE.cupom] ?? '').trim();
    if (cupomBruto === '' || cupomBruto.includes('#')) continue;

    const cupom = normalizarCupom(cupomBruto);
    const valorBruto = r.valores[COLUNAS_BASE.valor] ?? '';
    const mesAno = (r.valores[COLUNAS_BASE.mesAno] ?? '').trim();
    const status = (r.valores[COLUNAS_BASE.status] ?? '').trim();
    const valorCentavos = valorBaseCentavos(valorBruto);

    const hist = historicoPorCupom.get(cupom) ?? [];
    hist.push({ mesAno, valorCentavos, status });
    historicoPorCupom.set(cupom, hist);

    if (mesAno === mesAlvo && !valorBruto.includes('#') && !esperadoPorCupom.has(cupom)) {
      esperadoPorCupom.set(cupom, {
        valorCentavos,
        mesAno,
        id: (r.valores[COLUNAS_BASE.id] ?? '').trim(),
      });
    }
  }

  return { esperadoPorCupom, historicoPorCupom };
}

/**
 * Cruza as respostas do formulário com o esperado da base, produzindo as linhas a
 * processar (1ª resposta por cupom, com base e link presentes, fora das exclusões e
 * **ainda sem status** = pendente). A ordem segue a do formulário.
 */
export function montarLinhas(
  formRegistros: readonly RegistroPlanilha[],
  indice: IndiceBase,
  mapeamento: MapeamentoColunas,
  frente: Pick<Frente, 'papelLinkNf' | 'exclusoesCupom' | 'colunasSaida'>,
  mesAlvo: string,
): LinhaParaProcessar[] {
  const colCupom = mapeamento['cupom']?.coluna;
  const papelLink = frente.papelLinkNf ? PAPEL_LINK[frente.papelLinkNf] : undefined;
  const colLink = papelLink ? mapeamento[papelLink]?.coluna : undefined;
  if (!colCupom || !colLink) return []; // sem cupom/link mapeados → nada a processar

  const colStatus = frente.colunasSaida?.status;
  const exclusoes = new Set(frente.exclusoesCupom.map(normalizarCupom));
  const vistos = new Set<string>();
  const linhas: LinhaParaProcessar[] = [];

  for (const r of formRegistros) {
    const cupomBruto = (r.valores[colCupom] ?? '').trim();
    if (cupomBruto === '') continue;
    const link = (r.valores[colLink] ?? '').trim();
    if (link === '') continue;

    const cupom = normalizarCupom(cupomBruto);
    if (exclusoes.has(cupom)) continue;

    // Idempotência: pula a linha cujo status da frente já foi escrito.
    if (colStatus) {
      const st = (r.valores[colStatus] ?? '').trim();
      if (st !== '') continue;
    }

    if (vistos.has(cupom)) continue; // 1ª resposta por cupom

    const esperado = indice.esperadoPorCupom.get(cupom);
    if (!esperado) continue; // sem base no mês → ignora (n8n: ValorNF_Base exists)

    vistos.add(cupom);
    const linha: LinhaConferencia = {
      cupom,
      cupomOriginal: cupomBruto,
      linkNf: link,
      valorEsperadoCentavos: esperado.valorCentavos,
      mesAno: mesAlvo,
      ...(esperado.id ? { idBase: esperado.id } : {}),
    };
    linhas.push({ linha, numeroLinha: r.numeroLinha });
  }

  return linhas;
}
