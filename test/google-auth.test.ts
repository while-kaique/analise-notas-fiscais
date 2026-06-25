import { describe, it, expect } from 'vitest';
import {
  GoogleAuthProviderImpl,
  mapearCredenciais,
  ESCOPO_SHEETS,
} from '../src/auth/google-auth-provider.js';

const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:3000/auth/google/callback',
};

describe('GoogleAuthProviderImpl.getAuthUrl', () => {
  it('monta uma URL de consentimento com escopo, state e offline access', () => {
    const provider = new GoogleAuthProviderImpl(config);
    const url = provider.getAuthUrl('estado-csrf-123');
    const u = new URL(url);

    expect(u.origin + u.pathname).toContain('accounts.google.com');
    expect(u.searchParams.get('client_id')).toBe('client-id');
    expect(u.searchParams.get('state')).toBe('estado-csrf-123');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('scope')).toBe(ESCOPO_SHEETS);
    expect(u.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  });
});

describe('mapearCredenciais', () => {
  it('mapeia os campos presentes para TokensGoogle', () => {
    const tokens = mapearCredenciais({
      access_token: 'at',
      refresh_token: 'rt',
      expiry_date: 1234,
      scope: ESCOPO_SHEETS,
    });
    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiraEmMs: 1234,
      escopo: ESCOPO_SHEETS,
    });
  });

  it('omite campos opcionais ausentes (não atribui undefined)', () => {
    const tokens = mapearCredenciais({ access_token: 'at' });
    expect(tokens).toEqual({ accessToken: 'at' });
    expect('refreshToken' in tokens).toBe(false);
  });

  it('falha de forma acionável quando não há access_token', () => {
    expect(() => mapearCredenciais({})).toThrow(/access_token/);
  });
});
