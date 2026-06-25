/**
 * Cliente Google **Workers-native** (via `fetch`/REST) — OAuth2 + Sheets API v4.
 *
 * No Cloudflare Workers o SDK `googleapis` (F3) não roda; aqui falamos REST direto
 * (CLAUDE.md §11 — decisão de plataforma). Implementa os MESMOS contratos da F0
 * (`GoogleAuthProvider`, `SheetsClient`) e **reaproveita os helpers puros** de
 * `colunas.ts`/`spreadsheet-id.ts`, que rodam no edge sem alteração.
 */
import type {
  TokensGoogle,
  LinhaEntrada,
  LinhaResultado,
  StatusLinha,
} from '../types/index.js';
import { COLUNAS } from '../types/index.js';
import type { GoogleAuthProvider } from '../auth/index.js';
import type { SheetsClient, LeituraPlanilha } from '../sheets/index.js';
// Importa os helpers PUROS direto do módulo (não via index.js, que arrastaria googleapis).
import {
  construirMapaColunas,
  acharColuna,
  acharColunaLink,
  colunaParaA1,
  resultadoParaCelulas,
} from '../sheets/colunas.js';

/** Escopos: ler/escrever planilhas + identidade (e-mail) para o /me. */
export const ESCOPOS = [
  'https://www.googleapis.com/auth/spreadsheets',
  'openid',
  'email',
] as const;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface CredenciaisApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface RespostaToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

function mapearTokens(resp: RespostaToken, refreshAnterior?: string): TokensGoogle {
  if (!resp.access_token) {
    throw new Error('Resposta do Google sem access_token — não foi possível autenticar.');
  }
  const refresh = resp.refresh_token ?? refreshAnterior;
  return {
    accessToken: resp.access_token,
    ...(refresh ? { refreshToken: refresh } : {}),
    ...(typeof resp.expires_in === 'number'
      ? { expiraEmMs: Date.now() + resp.expires_in * 1000 }
      : {}),
    ...(resp.scope ? { escopo: resp.scope } : {}),
  };
}

/** `fetch` com erro acionável em respostas não-2xx (sem logar conteúdo de nota). */
async function pedir(url: string, init: RequestInit, oque: string): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    throw new Error(`Falha de rede ao ${oque}: ${motivo}`);
  }
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    throw new Error(
      `Google respondeu ${resp.status} ao ${oque}${corpo ? `: ${corpo.slice(0, 300)}` : ''}`,
    );
  }
  return resp;
}

/** Provider OAuth do usuário sobre o token endpoint REST. */
export class GoogleAuthRest implements GoogleAuthProvider {
  constructor(private readonly app: CredenciaisApp) {}

  getAuthUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: this.app.clientId,
      redirect_uri: this.app.redirectUri,
      response_type: 'code',
      scope: ESCOPOS.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTH_URL}?${p.toString()}`;
  }

  async exchangeCode(code: string): Promise<TokensGoogle> {
    const corpo = new URLSearchParams({
      code,
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
      redirect_uri: this.app.redirectUri,
      grant_type: 'authorization_code',
    });
    const resp = await pedir(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: corpo.toString(),
      },
      'trocar o código OAuth',
    );
    return mapearTokens((await resp.json()) as RespostaToken);
  }

  async refresh(refreshToken: string): Promise<TokensGoogle> {
    const corpo = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
      grant_type: 'refresh_token',
    });
    const resp = await pedir(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: corpo.toString(),
      },
      'renovar o access token',
    );
    // O Google não devolve refresh token no refresh; reaproveita o enviado.
    return mapearTokens((await resp.json()) as RespostaToken, refreshToken);
  }
}

/** Busca o e-mail do usuário (identidade) com um access token. */
export async function obterEmail(accessToken: string): Promise<string> {
  const resp = await pedir(
    USERINFO_URL,
    { headers: { authorization: `Bearer ${accessToken}` } },
    'ler o perfil do usuário',
  );
  const dados = (await resp.json()) as { email?: string };
  return dados.email ?? '';
}

// --- Sheets REST -------------------------------------------------------------

const STATUS_VALIDOS: ReadonlySet<string> = new Set<StatusLinha>([
  'PENDENTE',
  'PROCESSANDO',
  'CONCLUIDO',
  'ERRO',
]);

function ehStatusLinha(valor: string): valor is StatusLinha {
  return STATUS_VALIDOS.has(valor);
}

/** Nome da aba entre aspas simples para uso em range A1. */
function abaA1(aba: string): string {
  return `'${aba.replace(/'/g, "''")}'`;
}

/**
 * `SheetsClient` sobre a Sheets REST v4. Recebe um provedor de token (que cuida do
 * refresh) em vez dos tokens crus — assim o auto-refresh fica fora deste módulo.
 */
export class SheetsRest implements SheetsClient {
  constructor(private readonly obterToken: () => Promise<string>) {}

  private async cabecalhosAuth(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.obterToken()}` };
  }

  private async resolverAba(spreadsheetId: string, aba?: string): Promise<string> {
    if (aba !== undefined && aba.trim() !== '') return aba;
    const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
    const resp = await pedir(
      url,
      { headers: await this.cabecalhosAuth() },
      'ler as abas da planilha',
    );
    const dados = (await resp.json()) as {
      sheets?: { properties?: { title?: string } }[];
    };
    const titulo = dados.sheets?.[0]?.properties?.title;
    if (!titulo) {
      throw new Error(
        `Planilha ${spreadsheetId} não tem abas legíveis (verifique o acesso/compartilhamento).`,
      );
    }
    return titulo;
  }

  private async lerValores(spreadsheetId: string, range: string): Promise<unknown[][]> {
    const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const resp = await pedir(url, { headers: await this.cabecalhosAuth() }, 'ler a planilha');
    const dados = (await resp.json()) as { values?: unknown[][] };
    return dados.values ?? [];
  }

  async lerLinhas(spreadsheetId: string, aba?: string): Promise<LeituraPlanilha> {
    const abaResolvida = await this.resolverAba(spreadsheetId, aba);
    const linhasBrutas = await this.lerValores(spreadsheetId, abaA1(abaResolvida));

    const cabecalho = (linhasBrutas[0] ?? []).map((c) => String(c ?? ''));
    const mapa = construirMapaColunas(cabecalho);
    const colLink = acharColunaLink(mapa);
    const colStatus = acharColuna(mapa, COLUNAS.status);

    const linhas: LinhaEntrada[] = [];
    for (let i = 1; i < linhasBrutas.length; i++) {
      const linha = linhasBrutas[i] ?? [];
      const temConteudo = linha.some((c) => String(c ?? '').trim() !== '');
      if (!temConteudo) continue;

      const linkArquivo = colLink !== null ? String(linha[colLink] ?? '').trim() : '';
      const statusBruto = colStatus !== null ? String(linha[colStatus] ?? '').trim() : '';

      linhas.push({
        numeroLinha: i + 1,
        linkArquivo,
        ...(ehStatusLinha(statusBruto) ? { statusAtual: statusBruto } : {}),
      });
    }

    return { mapa, linhas, total: linhas.length };
  }

  async garantirColunas(
    spreadsheetId: string,
    headers: readonly string[],
    aba?: string,
  ): Promise<Record<string, number>> {
    const abaResolvida = await this.resolverAba(spreadsheetId, aba);
    const primeira = await this.lerValores(spreadsheetId, `${abaA1(abaResolvida)}!1:1`);
    const cabecalho = (primeira[0] ?? []).map((c) => String(c ?? ''));
    const mapa = construirMapaColunas(cabecalho);

    const faltando = headers.filter((h) => acharColuna(mapa, h) === null);
    if (faltando.length === 0) return mapa;

    const inicio = cabecalho.length;
    const range = `${abaA1(abaResolvida)}!${colunaParaA1(inicio)}1`;
    const url =
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
      `?valueInputOption=RAW`;
    await pedir(
      url,
      {
        method: 'PUT',
        headers: { ...(await this.cabecalhosAuth()), 'content-type': 'application/json' },
        body: JSON.stringify({ values: [faltando.slice()] }),
      },
      'criar as colunas de resultado',
    );

    faltando.forEach((h, k) => {
      mapa[h] = inicio + k;
    });
    return mapa;
  }

  async escreverResultados(
    spreadsheetId: string,
    resultados: readonly LinhaResultado[],
    aba?: string,
  ): Promise<void> {
    if (resultados.length === 0) return;
    const abaResolvida = await this.resolverAba(spreadsheetId, aba);
    const mapa = await this.garantirColunas(
      spreadsheetId,
      Object.values(COLUNAS),
      abaResolvida,
    );

    const data = resultados
      .flatMap((r) => resultadoParaCelulas(r, mapa, abaResolvida))
      .map((c) => ({ range: c.range, values: [[c.valor]] }));
    if (data.length === 0) return;

    const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
    await pedir(
      url,
      {
        method: 'POST',
        headers: { ...(await this.cabecalhosAuth()), 'content-type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data }),
      },
      'escrever os resultados na planilha',
    );
  }
}
