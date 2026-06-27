/**
 * Implementação de {@link GoDeployDB} sobre o `node:sqlite` (SQLite embutido do Node),
 * para rodar o worker localmente com o MESMO código de persistência do deploy.
 *
 * Só dev local (`src/local/`). Em produção o binding `env.DB` é fornecido pelo GoDeploy.
 */
import { DatabaseSync } from 'node:sqlite';
import type { GoDeployDB, ResultadoQuery, ResultadoExec } from '../api/env.js';

export function criarDbSqlite(caminho: string): GoDeployDB {
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  return {
    async query(sql: string, params: readonly unknown[]): Promise<ResultadoQuery> {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params);
      const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
      return { columns, rows, rowsRead: rows.length };
    },
    async exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec> {
      const stmt = db.prepare(sql);
      const info = stmt.run(...params);
      return { rowsWritten: Number(info.changes) };
    },
  };
}
