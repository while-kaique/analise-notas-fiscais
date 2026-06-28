import { describe, it, expect } from 'vitest';
import type { GoDeployDB } from '../src/api/env.js';
import { DDL_CONFERENCIA, initSchemaConferencia } from '../src/conferencia/index.js';

/** Fake mínimo do `env.DB` que só registra os SQL executados. */
function fakeDb(): { db: GoDeployDB; execs: string[] } {
  const execs: string[] = [];
  const db: GoDeployDB = {
    query: () => Promise.resolve({ columns: [], rows: [], rowsRead: 0 }),
    exec: (sql) => {
      execs.push(sql);
      return Promise.resolve({ rowsWritten: 0 });
    },
  };
  return { db, execs };
}

const TABELAS_ESPERADAS = [
  'conf_marcas',
  'conf_perfis',
  'conf_mapas',
  'conf_jobs',
  'conf_linhas',
  'conf_atividades',
];

describe('schema da conferência (env.DB)', () => {
  it('define as tabelas com prefixo conf_ e IF NOT EXISTS (idempotente)', () => {
    const tabelas = DDL_CONFERENCIA.filter((ddl) => ddl.includes('CREATE TABLE'));
    expect(tabelas).toHaveLength(TABELAS_ESPERADAS.length);
    for (const ddl of tabelas) {
      expect(ddl).toContain('CREATE TABLE IF NOT EXISTS conf_');
    }
    // Índices também são idempotentes.
    for (const ddl of DDL_CONFERENCIA.filter((d) => d.includes('CREATE INDEX'))) {
      expect(ddl).toContain('CREATE INDEX IF NOT EXISTS');
    }
  });

  it('cria todas as tabelas esperadas', async () => {
    const { db, execs } = fakeDb();
    await initSchemaConferencia(db);
    expect(execs).toHaveLength(DDL_CONFERENCIA.length);
    const sql = execs.join('\n');
    for (const tabela of TABELAS_ESPERADAS) {
      expect(sql).toContain(tabela);
    }
  });
});
