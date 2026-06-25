import { describe, it, expect } from 'vitest';
import {
  selarSessao,
  abrirSessao,
  lerCookie,
  cookieSessao,
} from '../src/api/sessao.js';

const SEGREDO = 'segredo-de-teste-bem-comprido';

describe('sessão assinada (HMAC)', () => {
  it('faz round-trip: sela e reabre o mesmo id', async () => {
    const id = 'abc-123';
    const selado = await selarSessao(id, SEGREDO);
    expect(selado.startsWith('abc-123.')).toBe(true);
    expect(await abrirSessao(selado, SEGREDO)).toBe(id);
  });

  it('rejeita assinatura adulterada', async () => {
    const selado = await selarSessao('abc-123', SEGREDO);
    const adulterado = selado.slice(0, -1) + (selado.endsWith('0') ? '1' : '0');
    expect(await abrirSessao(adulterado, SEGREDO)).toBeNull();
  });

  it('rejeita id trocado mantendo a assinatura antiga', async () => {
    const selado = await selarSessao('abc-123', SEGREDO);
    const assinatura = selado.slice(selado.indexOf('.'));
    expect(await abrirSessao('outro-id' + assinatura, SEGREDO)).toBeNull();
  });

  it('rejeita com segredo diferente', async () => {
    const selado = await selarSessao('abc-123', SEGREDO);
    expect(await abrirSessao(selado, 'outro-segredo')).toBeNull();
  });

  it('rejeita valor sem ponto', async () => {
    expect(await abrirSessao('semponto', SEGREDO)).toBeNull();
  });
});

describe('lerCookie', () => {
  it('extrai o cookie pelo nome', () => {
    expect(lerCookie('a=1; nf_sess=xyz.abc; b=2', 'nf_sess')).toBe('xyz.abc');
  });

  it('devolve null quando o header é nulo ou ausente', () => {
    expect(lerCookie(null, 'nf_sess')).toBeNull();
    expect(lerCookie('a=1; b=2', 'nf_sess')).toBeNull();
  });

  it('preserva "=" no valor', () => {
    expect(lerCookie('t=ab=cd', 't')).toBe('ab=cd');
  });
});

describe('cookieSessao', () => {
  it('marca HttpOnly, Secure e SameSite=Lax', () => {
    const c = cookieSessao('v');
    expect(c).toContain('nf_sess=v');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
  });
});
