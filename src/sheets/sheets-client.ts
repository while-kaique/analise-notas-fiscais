import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';
import type {
  TokensGoogle,
  MapaColunas,
  LinhaEntrada,
  LinhaResultado,
  StatusLinha,
} from '../types/index.js';
import { COLUNAS } from '../types/index.js';
import type {
  SheetsClient,
  LeituraPlanilha,
  CriarSheetsClient,
} from './index.js';
import type { ConfigOAuth, OAuth2Client } from '../auth/google-auth-provider.js';
import {
  construirMapaColunas,
  acharColuna,
  acharColunaLink,
  colunaParaA1,
  resultadoParaCelulas,
} from './colunas.js';

const STATUS_VALIDOS: ReadonlySet<string> = new Set<StatusLinha>([
  'PENDENTE',
  'PROCESSANDO',
  'CONCLUIDO',
  'ERRO',
]);

function ehStatusLinha(valor: string): valor is StatusLinha {
  return STATUS_VALIDOS.has(valor);
}

/** Range A1 que cobre a aba inteira (ou a primeira, se `aba` não vier). */
function rangeAba(aba: string): string {
  return `'${aba.replace(/'/g, "''")}'`;
}

/**
 * Implementação do `SheetsClient` sobre a Google Sheets API v4.
 *
 * Contrato (CLAUDE.md §4): identifica colunas por **cabeçalho**, cria as que
 * faltam, escreve em **lote** (`values.batchUpdate`) e só toca nas colunas de
 * resultado — nunca destrói dados do usuário.
 */
export class SheetsClientImpl implements SheetsClient {
  constructor(private readonly api: sheets_v4.Sheets) {}

  /** Resolve o título da aba; se não informado, usa a primeira da planilha. */
  private async resolverAba(spreadsheetId: string, aba?: string): Promise<string> {
    if (aba !== undefined && aba.trim() !== '') return aba;
    const resp = await this.api.spreadsheets.get({ spreadsheetId });
    const titulo = resp.data.sheets?.[0]?.properties?.title;
    if (!titulo) {
      throw new Error(
        `Planilha ${spreadsheetId} não tem abas legíveis (verifique o acesso/compartilhamento).`,
      );
    }
    return titulo;
  }

  async lerLinhas(spreadsheetId: string, aba?: string): Promise<LeituraPlanilha> {
    const abaResolvida = await this.resolverAba(spreadsheetId, aba);
    const resp = await this.api.spreadsheets.values.get({
      spreadsheetId,
      range: rangeAba(abaResolvida),
    });

    const linhasBrutas = (resp.data.values ?? []) as unknown[][];
    const cabecalho = (linhasBrutas[0] ?? []).map((c) => String(c ?? ''));
    const mapa = construirMapaColunas(cabecalho);

    const colLink = acharColunaLink(mapa);
    const colStatus = acharColuna(mapa, COLUNAS.status);

    const linhas: LinhaEntrada[] = [];
    for (let i = 1; i < linhasBrutas.length; i++) {
      const linha = linhasBrutas[i] ?? [];
      const temConteudo = linha.some((c) => String(c ?? '').trim() !== '');
      if (!temConteudo) continue; // pula linhas totalmente vazias

      const linkArquivo =
        colLink !== null ? String(linha[colLink] ?? '').trim() : '';

      const statusBruto =
        colStatus !== null ? String(linha[colStatus] ?? '').trim() : '';

      linhas.push({
        numeroLinha: i + 1, // 1-based; cabeçalho é a linha 1
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
  ): Promise<MapaColunas> {
    const abaResolvida = await this.resolverAba(spreadsheetId, aba);
    const resp = await this.api.spreadsheets.values.get({
      spreadsheetId,
      range: `${rangeAba(abaResolvida)}!1:1`,
    });

    const cabecalho = (resp.data.values?.[0] ?? []).map((c) => String(c ?? ''));
    const mapa = construirMapaColunas(cabecalho);

    const faltando = headers.filter((h) => acharColuna(mapa, h) === null);
    if (faltando.length === 0) return mapa;

    // Anexa as colunas que faltam ao final do cabeçalho (sem mexer nas existentes).
    const inicio = cabecalho.length;
    const rangeNovas = `${rangeAba(abaResolvida)}!${colunaParaA1(inicio)}1`;
    await this.api.spreadsheets.values.update({
      spreadsheetId,
      range: rangeNovas,
      valueInputOption: 'RAW',
      requestBody: { values: [faltando.slice()] },
    });

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

    // Garante que todas as colunas de resultado existem antes de escrever.
    const mapa = await this.garantirColunas(
      spreadsheetId,
      Object.values(COLUNAS),
      abaResolvida,
    );

    const data: sheets_v4.Schema$ValueRange[] = resultados
      .flatMap((r) => resultadoParaCelulas(r, mapa, abaResolvida))
      .map((c) => ({ range: c.range, values: [[c.valor]] }));

    if (data.length === 0) return;

    await this.api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data },
    });
  }
}

/** Monta o cliente Sheets v4 autenticado a partir de um OAuth2Client. */
function clienteSheets(auth: OAuth2Client): sheets_v4.Sheets {
  return google.sheets({ version: 'v4', auth });
}

/** Aplica os tokens do usuário a um OAuth2Client. */
function aplicarTokens(auth: OAuth2Client, tokens: TokensGoogle): void {
  auth.setCredentials({
    access_token: tokens.accessToken,
    ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
    ...(typeof tokens.expiraEmMs === 'number'
      ? { expiry_date: tokens.expiraEmMs }
      : {}),
  });
}

/**
 * Cria um `SheetsClient` a partir só dos tokens (sem auto-refresh — use quando o
 * access token ainda é válido). Para refresh automático, prefira
 * {@link criarSheetsClientCom} com as credenciais do app.
 */
export const criarSheetsClient: CriarSheetsClient = async (tokens) => {
  const auth = new google.auth.OAuth2();
  aplicarTokens(auth, tokens);
  return new SheetsClientImpl(clienteSheets(auth));
};

/**
 * Fábrica de `SheetsClient` que conhece as credenciais do app, permitindo que o
 * googleapis renove o access token sozinho a partir do refresh token.
 */
export function criarSheetsClientCom(config: ConfigOAuth): CriarSheetsClient {
  return async (tokens) => {
    const auth = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    );
    aplicarTokens(auth, tokens);
    return new SheetsClientImpl(clienteSheets(auth));
  };
}
