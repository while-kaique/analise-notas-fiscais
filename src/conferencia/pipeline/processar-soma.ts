/**
 * Reconciliação por **soma** (spec §4.6) — só no perfil Influencers, depois de
 * INFLUS e ASSESSORIA. Relê o formulário, acha cupons com **as duas** notas preenchidas
 * e **ainda não aprovadas**, soma os valores escritos e, se a soma melhora o status
 * (`statusEhMelhor`), grava o novo status nas **duas** colunas (influ + assessoria).
 */
import type { EntradaMapeamento, EscritaCelula } from '../contratos.js';
import type { ColunasSaida, Marca, PlanilhaRef, ResultadoConferencia } from '../tipos.js';
import { ROTULO_STATUS } from '../tipos.js';
import { reconciliarSoma, statusEhMelhor } from '../validacao/index.js';
import { resolverMapeamento } from '../mapeamento/index.js';
import { valorParaCentavos } from '../../parsing/index.js';
import { indexarBase, normalizarCupom } from './merge.js';
import { statusDeRotulo } from './escrita.js';
import type { DepsPipeline, OpcoesProcessamento, ResultadoFrente } from './tipos.js';

export interface ContextoSoma {
  perfilId: string;
  baseRef: PlanilhaRef;
  formRef: PlanilhaRef;
  influ: ColunasSaida;
  assessoria: ColunasSaida;
  marca: Marca;
  mesAlvo: string;
}

export async function processarSoma(
  ctx: ContextoSoma,
  deps: DepsPipeline,
  _opts: OpcoesProcessamento = {},
): Promise<ResultadoFrente> {
  const cabecalhos = await deps.leitor.lerCabecalho(ctx.formRef);
  const entrada: EntradaMapeamento = { cabecalhos, papeisEntrada: ['cupom'], papeisSaida: [] };
  const resol = await resolverMapeamento(
    { repo: deps.cacheMapa, mapeador: deps.mapeador },
    `${ctx.perfilId}:SOMA`,
    entrada,
  );
  if (resol.avaliacao.precisaConfirmar) {
    return { frente: 'SOMA', resultados: [], precisaConfirmarMapeamento: true, origemMapa: resol.origem };
  }
  const colCupom = resol.mapeamento['cupom']?.coluna;
  if (!colCupom) {
    return { frente: 'SOMA', resultados: [], precisaConfirmarMapeamento: false, origemMapa: resol.origem };
  }

  const indice = indexarBase(await deps.leitor.lerRegistros(ctx.baseRef), ctx.mesAlvo);
  const formReg = await deps.leitor.lerRegistros(ctx.formRef);

  const aprovado = ROTULO_STATUS.APROVADO;
  const resultados: ResultadoConferencia[] = [];
  const escritas: EscritaCelula[] = [];

  for (const r of formReg) {
    const cupomBruto = (r.valores[colCupom] ?? '').trim();
    if (cupomBruto === '') continue;

    const sInflu = (r.valores[ctx.influ.status] ?? '').trim();
    const sAssess = (r.valores[ctx.assessoria.status] ?? '').trim();
    if (sInflu === '' || sAssess === '') continue; // precisa das duas notas
    if (sInflu === aprovado && sAssess === aprovado) continue; // já aprovadas

    const vi = valorParaCentavos(r.valores[ctx.influ.valorNf] ?? '');
    const va = valorParaCentavos(r.valores[ctx.assessoria.valorNf] ?? '');
    if (vi === null || va === null) continue;

    const cupom = normalizarCupom(cupomBruto);
    const esperado = indice.esperadoPorCupom.get(cupom);
    if (!esperado) continue;

    const soma = reconciliarSoma({
      cupom,
      valorNfInfluCentavos: vi,
      valorNfAssessoriaCentavos: va,
      valorBaseCentavos: esperado.valorCentavos,
      margemParcialCentavos: ctx.marca.margemParcialCentavos,
    });

    const atual = statusDeRotulo(sInflu);
    if (atual !== undefined && statusEhMelhor(soma.status, atual)) {
      const rotulo = ROTULO_STATUS[soma.status];
      escritas.push({ numeroLinha: r.numeroLinha, coluna: ctx.influ.status, valor: rotulo });
      escritas.push({ numeroLinha: r.numeroLinha, coluna: ctx.assessoria.status, valor: rotulo });
      resultados.push({
        cupom,
        cupomOriginal: cupomBruto,
        status: soma.status,
        valorEsperadoCentavos: esperado.valorCentavos,
        retroativoCentavos: 0,
        valorTotalCentavos: soma.somaCentavos,
      });
    }
  }

  if (escritas.length > 0) await deps.leitor.escrever(ctx.formRef, escritas);
  return { frente: 'SOMA', resultados, precisaConfirmarMapeamento: false, origemMapa: resol.origem };
}
