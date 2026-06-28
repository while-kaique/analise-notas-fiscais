/**
 * `LeitorPlanilha` (contrato C0) sobre a **Google Sheets REST v4** — Workers-native
 * (só `fetch`). Recebe um provedor de token (`() => Promise<string>`), que em produção
 * é o `CredencialServico.obterAccessToken` da rpa_ia (C4). Lê registros por **cabeçalho**
 * e escreve em **lote** (`values:batchUpdate`), nunca célula a célula (CLAUDE.md §4).
 *
 * `aba` pode ser o **nome** da aba ou o **gid** (numérico) — resolve o título via metadados
 * quando vier gid ou vazio (o link do formulário traz gid).
 */
import type { PlanilhaRef } from '../tipos.js';
import type { EscritaCelula, LeitorPlanilha, RegistroPlanilha } from '../contratos.js';
import {
  acharColuna,
  colunaParaA1,
  construirMapaColunas,
  desambiguarCabecalhos,
} from '../../sheets/colunas.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
type FetchLike = typeof fetch;

async function pedir(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  oque: string,
): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetchImpl(url, init);
  } catch (e) {
    throw new Error(`Falha de rede ao ${oque}: ${e instanceof Error ? e.message : String(e)}.`);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Sheets respondeu ${resp.status} ao ${oque}${t ? `: ${t.slice(0, 300)}` : ''}.`);
  }
  return resp;
}

/** Nome da aba entre aspas simples para uso em range A1. */
function abaA1(titulo: string): string {
  return `'${titulo.replace(/'/g, "''")}'`;
}

export interface OpcoesLeitor {
  fetchImpl?: FetchLike;
}

export class LeitorPlanilhaRest implements LeitorPlanilha {
  readonly #obterToken: () => Promise<string>;
  readonly #fetch: FetchLike;
  readonly #titulos = new Map<string, string>();

  constructor(obterToken: () => Promise<string>, opts: OpcoesLeitor = {}) {
    this.#obterToken = obterToken;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  async #auth(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.#obterToken()}` };
  }

  /** Resolve o título da aba: nome direto, ou gid/vazio via metadados (com cache). */
  async #titulo(ref: PlanilhaRef): Promise<string> {
    const aba = (ref.aba ?? '').trim();
    if (aba !== '' && !/^\d+$/.test(aba)) return aba;

    const chave = `${ref.spreadsheetId}|${aba}`;
    const cacheado = this.#titulos.get(chave);
    if (cacheado !== undefined) return cacheado;

    const url = `${SHEETS_BASE}/${encodeURIComponent(ref.spreadsheetId)}?fields=sheets.properties(sheetId,title)`;
    const resp = await pedir(this.#fetch, url, { headers: await this.#auth() }, 'ler as abas da planilha');
    const dados = (await resp.json()) as {
      sheets?: { properties?: { sheetId?: number; title?: string } }[];
    };
    const props = (dados.sheets ?? []).map((s) => s.properties).filter((p): p is { sheetId?: number; title?: string } => p != null);

    const titulo =
      aba === '' ? props[0]?.title : props.find((p) => p.sheetId === Number(aba))?.title;
    if (!titulo) {
      throw new Error(
        `Aba não encontrada (spreadsheet ${ref.spreadsheetId}, aba "${aba || 'primeira'}").`,
      );
    }
    this.#titulos.set(chave, titulo);
    return titulo;
  }

  async #lerValores(spreadsheetId: string, range: string): Promise<string[][]> {
    const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const resp = await pedir(this.#fetch, url, { headers: await this.#auth() }, 'ler os valores');
    const dados = (await resp.json()) as { values?: unknown[][] };
    return (dados.values ?? []).map((linha) => linha.map((c) => String(c ?? '')));
  }

  async lerCabecalho(ref: PlanilhaRef): Promise<string[]> {
    const titulo = await this.#titulo(ref);
    const valores = await this.#lerValores(ref.spreadsheetId, `${abaA1(titulo)}!1:1`);
    // Desambigua cabeçalhos repetidos (form com seções influ+assessoria) — a IA mapeia
    // cada coluna sem ambiguidade; nada se perde.
    return desambiguarCabecalhos(valores[0] ?? []);
  }

  async lerRegistros(ref: PlanilhaRef): Promise<RegistroPlanilha[]> {
    const titulo = await this.#titulo(ref);
    const valores = await this.#lerValores(ref.spreadsheetId, abaA1(titulo));
    // Mesma desambiguação do cabeçalho → cada coluna duplicada vira uma chave única
    // (sem a última sobrescrever a primeira em `obj[h]`).
    const cabecalho = desambiguarCabecalhos(valores[0] ?? []);

    const registros: RegistroPlanilha[] = [];
    for (let i = 1; i < valores.length; i++) {
      const linha = valores[i] ?? [];
      if (!linha.some((c) => c.trim() !== '')) continue; // pula linha totalmente vazia
      const obj: Record<string, string> = {};
      cabecalho.forEach((h, j) => {
        if (h !== '') obj[h] = linha[j] ?? '';
      });
      registros.push({ numeroLinha: i + 1, valores: obj });
    }
    return registros;
  }

  async garantirColunas(ref: PlanilhaRef, colunas: readonly string[]): Promise<void> {
    const titulo = await this.#titulo(ref);
    const valores = await this.#lerValores(ref.spreadsheetId, `${abaA1(titulo)}!1:1`);
    const cabecalho = (valores[0] ?? []).map((c) => String(c ?? ''));
    const mapa = construirMapaColunas(cabecalho);

    const faltando = colunas.filter((c) => acharColuna(mapa, c) === null);
    if (faltando.length === 0) return;

    const range = `${abaA1(titulo)}!${colunaParaA1(cabecalho.length)}1`;
    const url =
      `${SHEETS_BASE}/${encodeURIComponent(ref.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    await pedir(
      this.#fetch,
      url,
      {
        method: 'PUT',
        headers: { ...(await this.#auth()), 'content-type': 'application/json' },
        body: JSON.stringify({ values: [faltando.slice()] }),
      },
      'criar colunas de saída',
    );
  }

  async escrever(ref: PlanilhaRef, escritas: readonly EscritaCelula[]): Promise<void> {
    if (escritas.length === 0) return;
    const titulo = await this.#titulo(ref);
    const cab = await this.#lerValores(ref.spreadsheetId, `${abaA1(titulo)}!1:1`);
    const mapa = construirMapaColunas((cab[0] ?? []).map((c) => String(c ?? '')));

    const data: { range: string; values: string[][] }[] = [];
    for (const e of escritas) {
      const indice = acharColuna(mapa, e.coluna);
      if (indice === null) continue; // coluna inexistente (garantirColunas deveria ter criado)
      data.push({ range: `${abaA1(titulo)}!${colunaParaA1(indice)}${e.numeroLinha}`, values: [[e.valor]] });
    }
    if (data.length === 0) return;

    const url = `${SHEETS_BASE}/${encodeURIComponent(ref.spreadsheetId)}/values:batchUpdate`;
    await pedir(
      this.#fetch,
      url,
      {
        method: 'POST',
        headers: { ...(await this.#auth()), 'content-type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
      },
      'escrever os resultados',
    );
  }
}
