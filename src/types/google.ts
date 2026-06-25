/** Tokens OAuth do Google obtidos no fluxo de login do usuário.
 *  Guarde com segurança (nunca commite; ver CLAUDE.md §6). */
export interface TokensGoogle {
  accessToken: string;
  /** Refresh token — pode não vir em re-consentimentos; guarde o primeiro. */
  refreshToken?: string;
  /** Expiração do access token em epoch (ms). */
  expiraEmMs?: number;
  /** Escopos concedidos. */
  escopo?: string;
}
