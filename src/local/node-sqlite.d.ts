/**
 * Tipos mínimos para `node:sqlite` (SQLite embutido do Node ≥ 22).
 *
 * Declarado localmente (mesmo padrão dos tipos do Workers em `env.ts`) porque o
 * `@types/node` v20 do projeto ainda não os traz — assim o `tsc` do gate compila sem
 * bumpar a dependência. Usado SÓ no servidor de dev local (`src/local/`), nunca no deploy.
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
