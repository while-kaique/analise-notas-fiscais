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

describe('schema da conferência (env.DB)', () => {
  it('define as 5 tabelas com prefixo conf_ e IF NOT EXISTS (idempotente)', () => {
    expect(DDL_CONFERENCIA).toHaveLength(5);
    for (const ddl of DDL_CONFERENCIA) {
      expect(ddl).toContain('CREATE TABLE IF NOT EXISTS conf_');
    }
  });

  it('cria todas as tabelas esperadas', async () => {
    const { db, execs } = fakeDb();
    await initSchemaConferencia(db);
    expect(execs).toHaveLength(5);
    const sql = execs.join('\n');
    for (const tabela of [
      'conf_marcas',
      'conf_perfis',
      'conf_mapas',
      'conf_jobs',
      'conf_linhas',
    ]) {
      expect(sql).toContain(tabela);
    }
  });
});
