import { describe, it, expect } from 'vitest';
import type { Job } from '../src/index.js';
import { FilaEmMemoria } from '../src/index.js';

function jobFake(id: string): Job {
  return {
    id,
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit',
    spreadsheetId: 'abc',
    donoId: 'user-1',
    criadoEm: '2026-06-25T12:00:00.000Z',
    status: 'CRIADO',
  };
}

function adiar(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('FilaEmMemoria', () => {
  it('progresso de job desconhecido é undefined', async () => {
    const fila = new FilaEmMemoria();
    expect(await fila.progresso('nao-existe')).toBeUndefined();
  });

  it('processa o job e marca CONCLUIDO; agrega progresso por linha', async () => {
    const fila = new FilaEmMemoria();

    fila.processar(async (job) => {
      const onProgresso = fila.onProgressoDe(job.id);
      onProgresso({ numeroLinha: 2, status: 'PROCESSANDO', processadoEm: 'x' });
      onProgresso({
        numeroLinha: 2,
        status: 'CONCLUIDO',
        nota: {
          cnpjEmitente: '11222333000181',
          dataEmissao: '2026-06-25',
          valorTotalCentavos: 5000,
        },
        processadoEm: 'x',
      });
      onProgresso({ numeroLinha: 3, status: 'ERRO', erro: 'x', processadoEm: 'x' });
    });

    await fila.enfileirar(jobFake('job-1'));
    await adiar();

    const p = await fila.progresso('job-1');
    expect(p?.status).toBe('CONCLUIDO');
    expect(p?.total).toBe(2);
    expect(p?.concluidos).toBe(1);
    expect(p?.erros).toBe(1);
    expect(p?.valorTotalCentavos).toBe(5000);
  });

  it('um job que lança vira FALHOU sem derrubar a fila', async () => {
    const fila = new FilaEmMemoria();
    const processados: string[] = [];

    fila.processar(async (job) => {
      processados.push(job.id);
      if (job.id === 'job-1') throw new Error('boom');
    });

    await fila.enfileirar(jobFake('job-1'));
    await fila.enfileirar(jobFake('job-2'));
    await adiar();

    expect((await fila.progresso('job-1'))?.status).toBe('FALHOU');
    expect((await fila.progresso('job-2'))?.status).toBe('CONCLUIDO');
    expect(processados).toEqual(['job-1', 'job-2']);
  });

  it('processa jobs enfileirados antes de registrar o handler', async () => {
    const fila = new FilaEmMemoria();
    await fila.enfileirar(jobFake('job-1'));

    let visto = false;
    fila.processar(async () => {
      visto = true;
    });
    await adiar();

    expect(visto).toBe(true);
    expect((await fila.progresso('job-1'))?.status).toBe('CONCLUIDO');
  });
});
