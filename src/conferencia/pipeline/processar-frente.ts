/**
 * Processa uma **frente de extração** (INFLUS/ASSESSORIA/EMBAIXADOR) — spec §4.
 *
 * Fluxo: resolve o mapa de colunas do formulário (IA + cache, C2) → lê base+form →
 * cruza por cupom (merge §4.1) → para cada cupom do lote: baixa a NF (C4) → extrai
 * campos (C3) → valida inicial + retroativo (C1) → escreve em lote (C0/C5). **Falha
 * isolada por cupom** (CLAUDE.md §3): erro de download/OCR/IA vira `NAO_LEGIVEL` + `erro`,
 * sem derrubar o lote. Se a IA não tem confiança no mapeamento, **não processa** e
 * sinaliza `precisaConfirmarMapeamento` (a UI da C6 trata).
 */
import type { EntradaMapeamento, EscritaCelula } from '../contratos.js';
import type {
  CamposNfBrutos,
  Frente,
  LinhaConferencia,
  Marca,
  PapelColunaEntrada,
  PapelLinkNf,
  PlanilhaRef,
  ResultadoConferencia,
} from '../tipos.js';
import { validarNfInicial, validarComRetroativo } from '../validacao/index.js';
import { resolverMapeamento } from '../mapeamento/index.js';
import { indexarBase, montarLinhas, type IndiceBase } from './merge.js';
import { resultadoParaEscritas } from './escrita.js';
import { BATCH_PADRAO, type DepsPipeline, type OpcoesProcessamento, type ResultadoFrente } from './tipos.js';
import { log } from '../../obs/log.js';

const PAPEL_LINK_ENTRADA: Readonly<Record<PapelLinkNf, PapelColunaEntrada>> = {
  influencer: 'linkNf_influencer',
  assessoria: 'linkNf_assessoria',
  unica: 'linkNf_unica',
};

export interface ContextoFrente {
  perfilId: string;
  baseRef: PlanilhaRef;
  formRef: PlanilhaRef;
  frente: Frente;
  marca: Marca;
  mesAlvo: string;
}

export async function processarFrente(
  ctx: ContextoFrente,
  deps: DepsPipeline,
  opts: OpcoesProcessamento = {},
): Promise<ResultadoFrente> {
  const { frente } = ctx;
  const flog = log.filho({ frente: frente.tipo });
  // Frente sem config de extração (ex.: SOMA) não passa por aqui.
  if (!frente.colunasSaida || !frente.papelLinkNf) {
    return { frente: frente.tipo, resultados: [], precisaConfirmarMapeamento: false };
  }
  flog.debug('frente: iniciando');

  const cabecalhos = await deps.leitor.lerCabecalho(ctx.formRef);
  const entrada: EntradaMapeamento = {
    cabecalhos,
    papeisEntrada: ['cupom', PAPEL_LINK_ENTRADA[frente.papelLinkNf]],
    papeisSaida: [],
  };
  const resol = await resolverMapeamento(
    { repo: deps.cacheMapa, mapeador: deps.mapeador },
    `${ctx.perfilId}:${frente.tipo}`,
    entrada,
  );
  if (resol.avaliacao.precisaConfirmar) {
    flog.warn('mapeamento incerto: precisa confirmação', { origem: resol.origem });
    return { frente: frente.tipo, resultados: [], precisaConfirmarMapeamento: true, origemMapa: resol.origem };
  }

  const baseReg = await deps.leitor.lerRegistros(ctx.baseRef);
  const indice = indexarBase(baseReg, ctx.mesAlvo);
  const formReg = await deps.leitor.lerRegistros(ctx.formRef);

  const limite = opts.batchLimit ?? BATCH_PADRAO;
  const linhas = montarLinhas(formReg, indice, resol.mapeamento, frente, ctx.mesAlvo).slice(0, limite);
  flog.info('cupons pendentes', { aProcessar: linhas.length, baseRegs: baseReg.length, formRegs: formReg.length, origemMapa: resol.origem });
  if (linhas.length === 0) {
    return { frente: frente.tipo, resultados: [], precisaConfirmarMapeamento: false, origemMapa: resol.origem };
  }

  // Cria as colunas de saída que faltarem antes de escrever (CLAUDE.md §4).
  await deps.leitor.garantirColunas(ctx.formRef, Object.values(frente.colunasSaida));

  const resultados: ResultadoConferencia[] = [];
  const escritas: EscritaCelula[] = [];
  for (const item of linhas) {
    const resultado = item.semBase
      ? resultadoSemBase(item.linha, ctx.mesAlvo)
      : await processarLinha(item.linha, ctx.marca, indice, deps);
    resultados.push(resultado);
    // Cupom + status (operacional); nunca valores/CNPJ (dados fiscais — §6).
    flog.debug('cupom processado', {
      cupom: resultado.cupom,
      status: resultado.status,
      ...(resultado.erro ? { erro: resultado.erro } : {}),
    });
    escritas.push(...resultadoParaEscritas(resultado, frente.colunasSaida, item.numeroLinha));
  }
  await deps.leitor.escrever(ctx.formRef, escritas);

  return { frente: frente.tipo, resultados, precisaConfirmarMapeamento: false, origemMapa: resol.origem };
}

/**
 * Resposta sem correspondência na base do mês: marca `SEM_BASE` (registra na planilha
 * que o cupom não foi encontrado), **sem** baixar/OCR a NF (decisão 2026-06-27).
 */
function resultadoSemBase(linha: LinhaConferencia, mesAlvo: string): ResultadoConferencia {
  return {
    cupom: linha.cupom,
    cupomOriginal: linha.cupomOriginal,
    status: 'SEM_BASE',
    valorEsperadoCentavos: 0,
    retroativoCentavos: 0,
    valorTotalCentavos: 0,
    erro: `Cupom não encontrado na base para ${mesAlvo}.`,
  };
}

/** Processa um único cupom: download → extração → validação inicial → (retroativo). */
async function processarLinha(
  linha: LinhaConferencia,
  marca: Marca,
  indice: IndiceBase,
  deps: DepsPipeline,
): Promise<ResultadoConferencia> {
  try {
    let campos: CamposNfBrutos | null = null;
    if (linha.linkNf.trim() !== '') {
      const arquivo = await deps.baixador.baixar(linha.linkNf);
      campos = await deps.extracao.extrairDoPdf(arquivo.bytes, arquivo.hash);
    }

    const ini = validarNfInicial(linha, campos, marca);
    if (!ini.precisaRetroativo) return ini.resultado;

    const valorNf = ini.resultado.valorNfCentavos;
    if (valorNf == null) return ini.resultado;

    const retro = validarComRetroativo({
      valorNfCentavos: valorNf,
      valorBaseCentavos: linha.valorEsperadoCentavos,
      mesAno: linha.mesAno,
      historico: indice.historicoPorCupom.get(linha.cupom) ?? [],
      statusBloqueantes: marca.statusBloqueantes,
      margemParcialCentavos: marca.margemParcialCentavos,
    });
    return { ...ini.resultado, ...retro };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      cupom: linha.cupom,
      cupomOriginal: linha.cupomOriginal,
      status: 'NAO_LEGIVEL',
      valorEsperadoCentavos: linha.valorEsperadoCentavos,
      retroativoCentavos: 0,
      valorTotalCentavos: linha.valorEsperadoCentavos,
      erro: msg,
    };
  }
}
