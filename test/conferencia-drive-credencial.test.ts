import { describe, it, expect } from 'vitest';
import {
  CredencialRefreshToken,
  urlConsentimentoServico,
  ESCOPOS_SERVICO,
} from '../src/conferencia/drive/credencial.js';

/** fetch fake que devolve respostas enfileiradas e conta chamadas. */
function fakeTokenFetch(respostas: Response[]) {
  const chamadas: { url: string; body: string }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), body: String(init?.body ?? '') });
    const r = respostas.shift();
    if (!r) throw new Error('sem resposta enfileirada');
    return r;
  }) as unknown as typeof fetch;
  return { fn, chamadas };
}

function respToken(accessToken: string, expiresIn = 3600): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CredencialRefreshToken', () => {
  it('troca o refresh token por access token e cacheia até perto de expirar', async () => {
    const { fn, chamadas } = fakeTokenFetch([respToken('a1'), respToken('a2')]);
    let t = 0;
    const cred = new CredencialRefreshToken({
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'r1',
      fetchImpl: fn,
      agora: () => t,
    });

    expect(await cred.obterAccessToken()).toBe('a1');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.body).toContain('grant_type=refresh_token');
    expect(chamadas[0]?.body).toContain('refresh_token=r1');

    // dentro da validade (margem 60s, ttl 3600s): não renova
    t = 3000 * 1000;
    expect(await cred.obterAccessToken()).toBe('a1');
    expect(chamadas).toHaveLength(1);

    // passou da janela (ttl - margem): renova
    t = 3600 * 1000;
    expect(await cred.obterAccessToken()).toBe('a2');
    expect(chamadas).toHaveLength(2);
  });

  it('erro acionável quando o Google rejeita (status != 2xx)', async () => {
    const { fn } = fakeTokenFetch([
      new Response('invalid_grant', { status: 400 }),
    ]);
    const cred = new CredencialRefreshToken({
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'ruim',
      fetchImpl: fn,
      agora: () => 0,
    });
    await expect(cred.obterAccessToken()).rejects.toThrow(/400/);
  });

  it('erro quando a resposta vem sem access_token', async () => {
    const { fn } = fakeTokenFetch([
      new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }),
    ]);
    const cred = new CredencialRefreshToken({
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'r1',
      fetchImpl: fn,
      agora: () => 0,
    });
    await expect(cred.obterAccessToken()).rejects.toThrow(/sem access_token/);
  });
});

describe('urlConsentimentoServico', () => {
  it('inclui os escopos de serviço, offline e prompt=consent', () => {
    const url = urlConsentimentoServico({ clientId: 'cid', redirectUri: 'https://app/cb' });
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    for (const escopo of ESCOPOS_SERVICO) {
      expect(decodeURIComponent(url)).toContain(escopo);
    }
  });
});
