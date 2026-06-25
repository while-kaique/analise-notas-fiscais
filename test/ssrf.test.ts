import { describe, it, expect } from 'vitest';
import {
  validarUrl,
  ipBloqueado,
  DestinoBloqueadoError,
} from '../src/download/ssrf.js';

describe('validarUrl', () => {
  it('aceita http e https', () => {
    expect(validarUrl('http://example.com/nota.pdf').protocol).toBe('http:');
    expect(validarUrl('https://example.com/nota.pdf').protocol).toBe('https:');
  });

  it('rejeita esquemas que não são http/https', () => {
    expect(() => validarUrl('file:///etc/passwd')).toThrow(DestinoBloqueadoError);
    expect(() => validarUrl('ftp://host/x')).toThrow(DestinoBloqueadoError);
    expect(() => validarUrl('gopher://host')).toThrow(DestinoBloqueadoError);
  });

  it('rejeita URL inválida/relativa', () => {
    expect(() => validarUrl('não é url')).toThrow(DestinoBloqueadoError);
    expect(() => validarUrl('/caminho/relativo')).toThrow(DestinoBloqueadoError);
  });
});

describe('ipBloqueado — IPv4', () => {
  it('bloqueia loopback, privados, link-local e CGNAT', () => {
    for (const ip of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.5.4',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // metadados de nuvem
      '100.64.0.1',
      '0.0.0.0',
      '255.255.255.255',
      '224.0.0.1', // multicast
    ]) {
      expect(ipBloqueado(ip), ip).toBe(true);
    }
  });

  it('libera IPs públicos', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34']) {
      expect(ipBloqueado(ip), ip).toBe(false);
    }
  });
});

describe('ipBloqueado — IPv6', () => {
  it('bloqueia loopback, unspecified, ULA, link-local e multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(ipBloqueado(ip), ip).toBe(true);
    }
  });

  it('bloqueia IPv4 interno mapeado em IPv6', () => {
    expect(ipBloqueado('::ffff:127.0.0.1')).toBe(true);
    expect(ipBloqueado('::ffff:192.168.0.1')).toBe(true);
  });

  it('libera IPv6 público', () => {
    expect(ipBloqueado('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
    expect(ipBloqueado('::ffff:8.8.8.8')).toBe(false);
  });

  it('remove a zona de escopo antes de classificar', () => {
    expect(ipBloqueado('fe80::1%eth0')).toBe(true);
  });
});

describe('ipBloqueado — entradas inválidas', () => {
  it('bloqueia o que não consegue interpretar (fail-safe)', () => {
    expect(ipBloqueado('não-é-ip')).toBe(true);
    expect(ipBloqueado('999.999.999.999')).toBe(true);
  });
});
