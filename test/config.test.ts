import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/index.js';

describe('loadConfig', () => {
  it('aplica defaults quando o ambiente está vazio', () => {
    const cfg = loadConfig({});
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.ocr.workerUrl).toBe('');
    expect(cfg.ocr.workerToken).toBe('');
    expect(cfg.ocr.timeoutMs).toBe(60000);
    expect(cfg.limites.maxPdfSizeMb).toBe(20);
    expect(cfg.redisUrl).toBeUndefined();
  });

  it('lê e converte valores do ambiente', () => {
    const cfg = loadConfig({
      PORT: '8080',
      OCR_WORKER_URL: 'https://ocr.example.workers.dev/',
      OCR_WORKER_TOKEN: 'tok-123',
      OCR_WORKER_TIMEOUT_MS: '90000',
      REDIS_URL: 'redis://localhost:6379',
      MAX_CONCURRENT_DOWNLOADS: '8',
    });
    expect(cfg.port).toBe(8080);
    expect(cfg.ocr.workerUrl).toBe('https://ocr.example.workers.dev/');
    expect(cfg.ocr.workerToken).toBe('tok-123');
    expect(cfg.ocr.timeoutMs).toBe(90000);
    expect(cfg.redisUrl).toBe('redis://localhost:6379');
    expect(cfg.limites.maxConcurrentDownloads).toBe(8);
  });

  it('rejeita número inválido com mensagem acionável', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('exige credenciais OAuth em produção', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/OAuth/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        GOOGLE_OAUTH_CLIENT_ID: 'id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
      }),
    ).not.toThrow();
  });
});
