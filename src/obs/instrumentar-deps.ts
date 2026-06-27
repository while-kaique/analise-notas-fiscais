/**
 * Instrumentação das dependências do pipeline (C5) — envolve cada borda de I/O
 * (Sheets, Drive, OCR+IA, mapeador) com logs de início/duração/erro, **sem tocar nas
 * implementações**. Aplicado em `montarDepsConferencia` (C6).
 *
 * Só loga metadados operacionais (contagens, durações, fileId, hash, presença de campos)
 * — **nunca** conteúdo de NF (valores/CNPJ/número/texto do OCR), CLAUDE.md §6.
 */
import type { DepsPipeline } from '../conferencia/pipeline/index.js';
import type { CamposNfBrutos } from '../conferencia/index.js';
import { type Logger, msgErro } from './log.js';

/** Mede uma operação async, logando sucesso (debug) e falha (error). */
async function medir<T>(
  log: Logger,
  evento: string,
  campos: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const inicio = Date.now();
  try {
    const r = await fn();
    log.debug(evento, { ...campos, ms: Date.now() - inicio });
    return r;
  } catch (e) {
    log.error(`${evento} falhou`, { ...campos, ms: Date.now() - inicio, erro: msgErro(e) });
    throw e;
  }
}

/** Encurta um link para o log (mantém host + cauda identificável, sem querystring gigante). */
function encurtarLink(link: string): string {
  if (link.length <= 80) return link;
  return `${link.slice(0, 64)}…${link.slice(-12)}`;
}

/** Quais campos a IA conseguiu extrair (chaves presentes — NUNCA os valores). */
function camposPresentes(campos: CamposNfBrutos | null): string[] {
  if (!campos) return [];
  return (Object.keys(campos) as (keyof CamposNfBrutos)[]).filter(
    (k) => campos[k] !== undefined && campos[k] !== null && campos[k] !== '',
  );
}

/**
 * Devolve uma cópia de `deps` com as bordas de I/O logadas. Preserva campos extras
 * (ex.: `repo` em `DepsConferencia`) via spread.
 */
export function instrumentarDeps<T extends DepsPipeline>(deps: T, log: Logger): T {
  const sheets = log.filho({ comp: 'sheets' });
  const drive = log.filho({ comp: 'drive' });
  const extr = log.filho({ comp: 'extracao' });
  const ia = log.filho({ comp: 'mapeador' });

  return {
    ...deps,
    leitor: {
      lerCabecalho: (ref) =>
        medir(sheets, 'lerCabecalho', { aba: ref.aba }, () => deps.leitor.lerCabecalho(ref)).then((r) => {
          sheets.debug('cabecalho', { aba: ref.aba, colunas: r.length });
          return r;
        }),
      lerRegistros: (ref) =>
        medir(sheets, 'lerRegistros', { aba: ref.aba }, () => deps.leitor.lerRegistros(ref)).then((r) => {
          sheets.info('registros lidos', { aba: ref.aba, linhas: r.length });
          return r;
        }),
      garantirColunas: (ref, colunas) =>
        medir(sheets, 'garantirColunas', { aba: ref.aba, colunas: colunas.length }, () =>
          deps.leitor.garantirColunas(ref, colunas),
        ),
      escrever: (ref, escritas) =>
        medir(sheets, 'escrever', { aba: ref.aba, celulas: escritas.length }, () =>
          deps.leitor.escrever(ref, escritas),
        ),
    },
    baixador: {
      baixar: (link) =>
        medir(drive, 'baixar', { link: encurtarLink(link) }, () => deps.baixador.baixar(link)).then((a) => {
          drive.info('baixado', { tipo: a.tipo, bytes: a.bytes.length, hash: a.hash.slice(0, 12) });
          return a;
        }),
    },
    extracao: {
      extrairDoPdf: (bytes, hash) =>
        medir(extr, 'extrairDoPdf', { bytes: bytes.length, hash: hash?.slice(0, 12) }, () =>
          deps.extracao.extrairDoPdf(bytes, hash),
        ).then((campos) => {
          extr.info('campos extraídos', { presentes: camposPresentes(campos) });
          return campos;
        }),
    },
    mapeador: {
      mapear: (entrada) =>
        medir(
          ia,
          'mapear',
          { papeis: [...entrada.papeisEntrada], cabecalhos: entrada.cabecalhos.length },
          () => deps.mapeador.mapear(entrada),
        ).then((mapa) => {
          const resumo = Object.fromEntries(
            Object.entries(mapa)
              .filter((e): e is [string, NonNullable<(typeof e)[1]>] => e[1] != null)
              .map(([papel, m]) => [papel, { coluna: m.coluna, conf: m.confianca }]),
          );
          ia.info('mapa resolvido', { mapa: resumo });
          return mapa;
        }),
    },
  };
}
