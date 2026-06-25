import { google } from 'googleapis';
import type { TokensGoogle } from '../types/index.js';
import type { GoogleAuthProvider } from './index.js';

/** Tipo do cliente OAuth2 exatamente como o `googleapis` o expõe (evita conflito
 *  entre cópias duplicadas de `google-auth-library` sob `exactOptionalPropertyTypes`). */
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
/** Credenciais aceitas por `OAuth2Client.setCredentials`. */
export type Credentials = Parameters<OAuth2Client['setCredentials']>[0];

/** Escopo mínimo: ler/escrever as planilhas do usuário. */
export const ESCOPO_SHEETS = 'https://www.googleapis.com/auth/spreadsheets';

/** Configuração OAuth necessária para o provider (subconjunto de `Config.google`). */
export interface ConfigOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Cria um cliente OAuth2 do googleapis a partir da configuração. */
export function criarOAuthClient(config: ConfigOAuth): OAuth2Client {
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

/**
 * Converte as credenciais do googleapis para o nosso `TokensGoogle`.
 * Respeita `exactOptionalPropertyTypes`: campos ausentes não são incluídos
 * (não se atribui `undefined`).
 */
export function mapearCredenciais(cred: Credentials): TokensGoogle {
  if (!cred.access_token) {
    throw new Error(
      'Resposta do Google sem access_token — não foi possível autenticar.',
    );
  }
  return {
    accessToken: cred.access_token,
    ...(cred.refresh_token ? { refreshToken: cred.refresh_token } : {}),
    ...(typeof cred.expiry_date === 'number'
      ? { expiraEmMs: cred.expiry_date }
      : {}),
    ...(cred.scope ? { escopo: cred.scope } : {}),
  };
}

/**
 * Implementa o fluxo OAuth do usuário (CLAUDE.md §Decisões: OAuth, não Service
 * Account). `access_type: 'offline'` + `prompt: 'consent'` garantem o refresh
 * token no primeiro consentimento — guarde-o com segurança e nunca o commite.
 */
export class GoogleAuthProviderImpl implements GoogleAuthProvider {
  private readonly cliente: OAuth2Client;

  constructor(config: ConfigOAuth) {
    this.cliente = criarOAuthClient(config);
  }

  getAuthUrl(state: string): string {
    return this.cliente.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [ESCOPO_SHEETS],
      state,
    });
  }

  async exchangeCode(code: string): Promise<TokensGoogle> {
    const { tokens } = await this.cliente.getToken(code);
    return mapearCredenciais(tokens);
  }

  async refresh(refreshToken: string): Promise<TokensGoogle> {
    this.cliente.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.cliente.refreshAccessToken();
    // Reaproveita o refresh token enviado se o Google não devolver um novo.
    return mapearCredenciais({
      ...credentials,
      refresh_token: credentials.refresh_token ?? refreshToken,
    });
  }
}

/** Fábrica conveniente para o `GoogleAuthProvider`. */
export function criarGoogleAuthProvider(config: ConfigOAuth): GoogleAuthProvider {
  return new GoogleAuthProviderImpl(config);
}
