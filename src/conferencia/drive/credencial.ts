/**
 * Credencial de **identidade de serviço** (decisão 11 do spec): o RPA acessa o
 * Drive/Sheets como `rpa_ia@gocase.com` usando um **refresh token de longa duração**
 * (consentimento offline 1x), trocado por **access token** a cada necessidade.
 *
 * NÃO é OAuth por usuário nem Service Account. Workers-native (só `fetch`).
 */
import { ErroDrive, type FetchLike } from './comum.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Escopos que a `rpa_ia` precisa conceder no consentimento (1x). */
export const ESCOPOS_SERVICO = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

/** Fornece um access token válido (renovando quando necessário). */
export interface CredencialServico {
  obterAccessToken(): Promise<string>;
}

export interface OpcoesCredencial {
  clientId: string;
  clientSecret: string;
  /** Refresh token de longa duração da rpa_ia (segredo `GOOGLE_OAUTH_REFRESH_TOKEN`). */
  refreshToken: string;
  fetchImpl?: FetchLike;
  /** Relógio injetável (testes). Default `Date.now`. */
  agora?: () => number;
  /** Margem (ms) antes da expiração para renovar proativamente. Default 60s. */
  margemRenovacaoMs?: number;
}

interface RespostaToken {
  access_token?: string;
  expires_in?: number;
}

/**
 * Implementa {@link CredencialServico} via `grant_type=refresh_token`. Cacheia o
 * access token em memória até perto de expirar (o Google não devolve novo refresh
 * token no refresh; o mesmo é reutilizado).
 */
export class CredencialRefreshToken implements CredencialServico {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #refreshToken: string;
  readonly #fetch: FetchLike;
  readonly #agora: () => number;
  readonly #margem: number;

  #accessToken: string | null = null;
  #expiraEmMs = 0;

  constructor(opts: OpcoesCredencial) {
    this.#clientId = opts.clientId;
    this.#clientSecret = opts.clientSecret;
    this.#refreshToken = opts.refreshToken;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#agora = opts.agora ?? (() => Date.now());
    this.#margem = opts.margemRenovacaoMs ?? 60_000;
  }

  async obterAccessToken(): Promise<string> {
    if (this.#accessToken !== null && this.#agora() < this.#expiraEmMs - this.#margem) {
      return this.#accessToken;
    }
    return this.#renovar();
  }

  async #renovar(): Promise<string> {
    const corpo = new URLSearchParams({
      refresh_token: this.#refreshToken,
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
      grant_type: 'refresh_token',
    });

    let resposta: Response;
    try {
      resposta = await this.#fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: corpo.toString(),
      });
    } catch (causa) {
      const motivo = causa instanceof Error ? causa.message : String(causa);
      throw new ErroDrive(`Falha de rede ao renovar o token da rpa_ia: ${motivo}.`);
    }

    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => '');
      throw new ErroDrive(
        `Google respondeu ${resposta.status} ao renovar o token da rpa_ia` +
          `${texto ? `: ${texto.slice(0, 200)}` : ''}. Verifique o refresh token e o consentimento.`,
      );
    }

    const dados = (await resposta.json()) as RespostaToken;
    if (!dados.access_token) {
      throw new ErroDrive('Resposta do Google sem access_token ao renovar o token da rpa_ia.');
    }

    this.#accessToken = dados.access_token;
    const ttlMs = (typeof dados.expires_in === 'number' ? dados.expires_in : 3600) * 1000;
    this.#expiraEmMs = this.#agora() + ttlMs;
    return this.#accessToken;
  }
}

/**
 * URL de consentimento **offline** para gerar o refresh token da rpa_ia (passo manual,
 * uma vez). Exige a tela de consentimento OAuth publicada ("Em produção"), senão o
 * refresh token expira em 7 dias.
 */
export function urlConsentimentoServico(p: {
  clientId: string;
  redirectUri: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: ESCOPOS_SERVICO.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${q.toString()}`;
}
