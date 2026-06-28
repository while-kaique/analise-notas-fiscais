/**
 * Schema do `env.DB` (SQLite do GoDeploy) para a **Conferência por Cupom** (v2).
 *
 * **Aditivo** e idempotente (CREATE TABLE IF NOT EXISTS): não toca nas tabelas do v1
 * (`sessoes`/`jobs`/`linhas` em `src/api/db.ts`). É wireado pelas fatias C5/C6; aqui só
 * definimos a DDL (e a fatia C5 trará as funções de repositório sobre estas tabelas).
 *
 * Tabelas (prefixo `conf_` para não colidir com o v1):
 * - `conf_marcas`  — config por marca (spec §3).
 * - `conf_perfis`  — base fixa + link do form do mês + frentes (JSON).
 * - `conf_mapas`   — cache do mapa de colunas (IA) por chave `perfilId:FRENTE` (spec §6).
 * - `conf_jobs`    — uma execução = (perfil, mês). Avança por cron (spec §7).
 * - `conf_linhas`  — uma linha conferida por (job, frente, cupom). Idempotência por status.
 * - `conf_atividades` — feed cronológico de eventos do job (a tela "rolando"). Append-only,
 *   `id` autoincremental serve de cursor para o poll do frontend; `chave` (UNIQUE) dá
 *   idempotência (ticks concorrentes do cron não duplicam um marco/cupom no feed).
 */
import type { GoDeployDB } from '../../api/env.js';

/** DDL de cada tabela (exportada também para teste/inspeção). */
export const DDL_CONFERENCIA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS conf_marcas (
     id TEXT PRIMARY KEY,
     nome TEXT NOT NULL,
     cnpj_tomador TEXT NOT NULL DEFAULT '',
     status_bloqueantes TEXT NOT NULL DEFAULT '[]',
     margem_parcial_centavos INTEGER NOT NULL DEFAULT 3000
   )`,
  `CREATE TABLE IF NOT EXISTS conf_perfis (
     id TEXT PRIMARY KEY,
     marca_id TEXT NOT NULL,
     nome TEXT NOT NULL,
     base_spreadsheet_id TEXT NOT NULL DEFAULT '',
     base_aba TEXT NOT NULL DEFAULT '',
     form_sheet_url TEXT,
     frentes TEXT NOT NULL DEFAULT '[]'
   )`,
  `CREATE TABLE IF NOT EXISTS conf_mapas (
     chave TEXT PRIMARY KEY,
     mapa TEXT NOT NULL DEFAULT '{}'
   )`,
  `CREATE TABLE IF NOT EXISTS conf_jobs (
     id TEXT PRIMARY KEY,
     perfil_id TEXT NOT NULL,
     mes_alvo TEXT NOT NULL,
     form_sheet_url TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL,
     pendencia_mapa TEXT,
     erro TEXT,
     criado_em TEXT NOT NULL,
     atualizado_em TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS conf_linhas (
     job_id TEXT NOT NULL,
     frente TEXT NOT NULL,
     cupom TEXT NOT NULL,
     numero_linha_form INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL,
     valor_nf_centavos INTEGER NOT NULL DEFAULT 0,
     valor_esperado_centavos INTEGER NOT NULL DEFAULT 0,
     retroativo_centavos INTEGER NOT NULL DEFAULT 0,
     erro TEXT,
     processado_em TEXT,
     PRIMARY KEY (job_id, frente, cupom)
   )`,
  `CREATE TABLE IF NOT EXISTS conf_atividades (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     job_id TEXT NOT NULL,
     chave TEXT NOT NULL UNIQUE,
     frente TEXT,
     cupom TEXT,
     tipo TEXT NOT NULL,
     status TEXT,
     mensagem TEXT NOT NULL,
     criado_em TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_conf_atividades_job ON conf_atividades (job_id, id)`,
] as const;

/** Cria as tabelas da conferência se ainda não existirem (idempotente). */
export async function initSchemaConferencia(db: GoDeployDB): Promise<void> {
  for (const ddl of DDL_CONFERENCIA) {
    await db.exec(ddl, []);
  }
}
