import { describe, it, expect } from 'vitest';
import type { GoDeployDB } from '../src/api/env.js';
import {
  registrarAtividades,
  lerAtividades,
  type NovaAtividade,
} from '../src/conferencia/persistencia/jobs-db.js';
import { atividadesDoResumo } from '../src/api/conferencia-processar.js';
import type { ResultadoFrente } from '../src/conferencia/pipeline/index.js';
import type { ResultadoConferencia, StatusConferencia } from '../src/conferencia/index.js';

// ─────────── Fake stateful do env.DB só para as duas queries do feed ───────────
interface LinhaAtv {
  id: number;
  job_id: string;
  chave: string;
  frente: string | null;
  cupom: string | null;
  tipo: string;
  status: string | null;
  mensagem: string;
  criado_em: string;
}

function fakeDb(): GoDeployDB {
  const linhas: LinhaAtv[] = [];
  const chaves = new Set<string>(); // simula a constraint UNIQUE (INSERT OR IGNORE)
  let seq = 0;
  return {
    exec: (_sql, params) => {
      const [job_id, chave, frente, cupom, tipo, status, mensagem, criado_em] = params as (
        | string
        | null
      )[];
      if (chaves.has(chave as string)) return Promise.resolve({ rowsWritten: 0 });
      chaves.add(chave as string);
      linhas.push({
        id: ++seq,
        job_id: job_id as string,
        chave: chave as string,
        frente: frente as string | null,
        cupom: cupom as string | null,
        tipo: tipo as string,
        status: status as string | null,
        mensagem: mensagem as string,
        criado_em: criado_em as string,
      });
      return Promise.resolve({ rowsWritten: 1 });
    },
    query: (_sql, params) => {
      const [jobId, desde, limite] = params as [string, number, number];
      const rows = linhas
        .filter((l) => l.job_id === jobId && l.id > desde)
        .sort((a, b) => a.id - b.id)
        .slice(0, limite);
      return Promise.resolve({
        columns: ['id', 'job_id', 'frente', 'cupom', 'tipo', 'status', 'mensagem', 'criado_em'],
        rows: rows as unknown[],
        rowsRead: rows.length,
      });
    },
  };
}

function res(cupom: string, status: StatusConferencia, erro?: string): ResultadoConferencia {
  return {
    cupom: cupom.toUpperCase(),
    cupomOriginal: cupom,
    status,
    valorEsperadoCentavos: 100,
    retroativoCentavos: 0,
    valorTotalCentavos: 100,
    ...(erro ? { erro } : {}),
  };
}

function frente(over: Partial<ResultadoFrente> & Pick<ResultadoFrente, 'frente'>): ResultadoFrente {
  return { resultados: [], precisaConfirmarMapeamento: false, ...over };
}

describe('atividadesDoResumo', () => {
  it('gera um evento por cupom + um marcador por frente que processou', () => {
    const evs = atividadesDoResumo([
      frente({ frente: 'INFLUS', resultados: [res('abc', 'APROVADO'), res('def', 'PARCIAL')] }),
      frente({ frente: 'ASSESSORIA' }), // sem cupom → sem evento
      frente({ frente: 'SOMA', resultados: [res('abc', 'APROVADO')] }),
    ]);
    const tipos = evs.map((e) => e.tipo);
    expect(tipos).toEqual(['cupom', 'cupom', 'frente_concluida', 'soma', 'frente_concluida']);
    // usa o cupom como o usuário digitou e o rótulo PT-BR do status
    expect(evs[0]!.mensagem).toContain('cupom abc');
    expect(evs[0]!.mensagem).toContain('Aprovado');
  });

  it('inclui a mensagem de erro quando há, e não vaza valor/CNPJ (§6)', () => {
    const evs = atividadesDoResumo([
      frente({ frente: 'INFLUS', resultados: [res('x', 'NAO_LEGIVEL', 'OCR ilegível')] }),
    ]);
    expect(evs[0]!.mensagem).toContain('OCR ilegível');
    // o evento só carrega cupom/frente/status/dedupeKey — nenhum campo fiscal (§6).
    expect(Object.keys(evs[0]!).sort()).toEqual([
      'cupom',
      'dedupeKey',
      'frente',
      'mensagem',
      'status',
      'tipo',
    ]);
    expect(evs[0]!.dedupeKey).not.toMatch(/\d{2}\/\d{2}\/\d{4}|R\$|cnpj/i);
  });
});

describe('registrarAtividades / lerAtividades (cursor incremental)', () => {
  it('persiste e lê só o que veio depois do cursor, em ordem', async () => {
    const db = fakeDb();
    const lote: NovaAtividade[] = [
      { tipo: 'job_iniciado', mensagem: 'iniciada' },
      { tipo: 'cupom', frente: 'INFLUS', cupom: 'A', status: 'APROVADO', mensagem: 'A → ok' },
    ];
    await registrarAtividades(db, 'job1', lote);

    const primeira = await lerAtividades(db, 'job1', 0);
    expect(primeira.map((a) => a.id)).toEqual([1, 2]);
    expect(primeira[1]!.cupom).toBe('A');

    // nada novo desde o último id
    expect(await lerAtividades(db, 'job1', 2)).toHaveLength(0);

    // novo evento entra e só ele é lido a partir do cursor
    await registrarAtividades(db, 'job1', [{ tipo: 'job_concluido', mensagem: 'fim' }]);
    const novas = await lerAtividades(db, 'job1', 2);
    expect(novas.map((a) => a.id)).toEqual([3]);
    expect(novas[0]!.mensagem).toBe('fim');
  });

  it('isola por job e ignora lote vazio', async () => {
    const db = fakeDb();
    await registrarAtividades(db, 'jobA', [{ tipo: 'cupom', mensagem: 'a' }]);
    await registrarAtividades(db, 'jobB', []); // no-op
    expect(await lerAtividades(db, 'jobB', 0)).toHaveLength(0);
    expect(await lerAtividades(db, 'jobA', 0)).toHaveLength(1);
  });

  it('dedupeKey evita duplicar marco em ticks concorrentes; sem ela sempre insere', async () => {
    const db = fakeDb();
    // Mesmo marco emitido duas vezes (corrida) → entra só uma vez.
    await registrarAtividades(db, 'job1', [
      { tipo: 'job_concluido', dedupeKey: 'job_concluido', mensagem: 'fim' },
    ]);
    await registrarAtividades(db, 'job1', [
      { tipo: 'job_concluido', dedupeKey: 'job_concluido', mensagem: 'fim' },
    ]);
    // Marcador de lote (sem dedupeKey) emitido duas vezes → entra as duas.
    await registrarAtividades(db, 'job1', [{ tipo: 'frente_concluida', mensagem: 'lote' }]);
    await registrarAtividades(db, 'job1', [{ tipo: 'frente_concluida', mensagem: 'lote' }]);

    const todas = await lerAtividades(db, 'job1', 0);
    expect(todas.filter((a) => a.tipo === 'job_concluido')).toHaveLength(1);
    expect(todas.filter((a) => a.tipo === 'frente_concluida')).toHaveLength(2);
  });
});
