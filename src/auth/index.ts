import type { TokensGoogle } from '../types/index.js';

/**
 * Abstrai o fluxo OAuth do Google (login do usuário).
 * Implementação: fatia F3 (auth + sheets), usando `googleapis`.
 *
 * Escopos mínimos: leitura/escrita de Sheets do usuário
 * (`https://www.googleapis.com/auth/spreadsheets`).
 */
export interface GoogleAuthProvider {
  /** Monta a URL de consentimento. `state` protege contra CSRF e carrega contexto. */
  getAuthUrl(state: string): string;
  /** Troca o `code` do callback pelos tokens. */
  exchangeCode(code: string): Promise<TokensGoogle>;
  /** Renova o access token a partir do refresh token. */
  refresh(refreshToken: string): Promise<TokensGoogle>;
}
