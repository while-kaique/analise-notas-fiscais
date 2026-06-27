/**
 * `RepositorioPerfis` sobre o `env.DB` (SQLite do GoDeploy) — a impl de produção da
 * C6 (a `RepositorioPerfisMemoria` da C0 segue para dev/testes).
 *
 * - Marcas/perfis vêm de `conf_marcas`/`conf_perfis`, **semeados** na 1ª execução a
 *   partir de {@link MARCAS_SEED}/{@link PERFIS_SEED} (Gocase real + Gobeaute esqueleto).
 * - O **cache do mapa de colunas** (`obterMapeamento`/`salvarMapeamento`) é keyed por
 *   uma chave livre (`perfilId:FRENTE`, como o pipeline usa) em `conf_mapas` — por isso
 *   ele NÃO valida que a chave é um perfil existente (diferente da impl em memória).
 *
 * O `frentes` e o `mapa` são guardados como JSON. Leitura defensiva (JSON inválido →
 * default vazio) para não derrubar um tick por dado corrompido (falha isolada §3).
 */
import type { Marca, Perfil, MapeamentoColunas, Frente } from '../tipos.js';
import type { RepositorioPerfis } from '../contratos.js';
import type { GoDeployDB } from '../../api/env.js';
import { primeiraLinha, linhasComoObjetos, comoTexto, comoInteiro } from '../../api/env.js';
import { MARCAS_SEED, PERFIS_SEED } from '../perfis/seed.js';
import { initSchemaConferencia } from './schema.js';

function parseJson<T>(texto: string, fallback: T): T {
  if (!texto) return fallback;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return fallback;
  }
}

function mapearMarca(linha: Record<string, unknown>): Marca {
  return {
    id: comoTexto(linha['id']),
    nome: comoTexto(linha['nome']),
    cnpjTomador: comoTexto(linha['cnpj_tomador']),
    statusBloqueantes: parseJson<string[]>(comoTexto(linha['status_bloqueantes']), []),
    margemParcialCentavos: comoInteiro(linha['margem_parcial_centavos']),
  };
}

function mapearPerfil(linha: Record<string, unknown>): Perfil {
  const formUrl = comoTexto(linha['form_sheet_url']);
  return {
    id: comoTexto(linha['id']),
    marcaId: comoTexto(linha['marca_id']),
    nome: comoTexto(linha['nome']),
    base: {
      spreadsheetId: comoTexto(linha['base_spreadsheet_id']),
      aba: comoTexto(linha['base_aba']),
    },
    ...(formUrl ? { formSheetUrl: formUrl } : {}),
    frentes: parseJson<Frente[]>(comoTexto(linha['frentes']), []),
  };
}

export class RepositorioPerfisDb implements RepositorioPerfis {
  readonly #db: GoDeployDB;

  constructor(db: GoDeployDB) {
    this.#db = db;
  }

  /** Garante o schema e semeia marcas/perfis na 1ª vez (idempotente). */
  async inicializar(): Promise<void> {
    await initSchemaConferencia(this.#db);
    const res = await this.#db.query('SELECT COUNT(*) AS n FROM conf_marcas');
    const n = comoInteiro(primeiraLinha(res)?.['n']);
    if (n > 0) return;
    await this.#semear();
  }

  async #semear(): Promise<void> {
    for (const m of MARCAS_SEED) {
      await this.#db.exec(
        `INSERT INTO conf_marcas (id, nome, cnpj_tomador, status_bloqueantes, margem_parcial_centavos)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        [
          m.id,
          m.nome,
          m.cnpjTomador,
          JSON.stringify(m.statusBloqueantes),
          m.margemParcialCentavos,
        ],
      );
    }
    for (const p of PERFIS_SEED) {
      await this.#db.exec(
        `INSERT INTO conf_perfis (id, marca_id, nome, base_spreadsheet_id, base_aba, form_sheet_url, frentes)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        [
          p.id,
          p.marcaId,
          p.nome,
          p.base.spreadsheetId,
          p.base.aba,
          p.formSheetUrl ?? null,
          JSON.stringify(p.frentes),
        ],
      );
    }
  }

  async listarMarcas(): Promise<Marca[]> {
    const res = await this.#db.query('SELECT * FROM conf_marcas ORDER BY nome ASC');
    return linhasComoObjetos(res).map(mapearMarca);
  }

  async obterMarca(id: string): Promise<Marca | undefined> {
    const res = await this.#db.query('SELECT * FROM conf_marcas WHERE id = ?', [id]);
    const linha = primeiraLinha(res);
    return linha ? mapearMarca(linha) : undefined;
  }

  async listarPerfis(marcaId?: string): Promise<Perfil[]> {
    const res = marcaId
      ? await this.#db.query('SELECT * FROM conf_perfis WHERE marca_id = ? ORDER BY nome ASC', [marcaId])
      : await this.#db.query('SELECT * FROM conf_perfis ORDER BY nome ASC');
    return linhasComoObjetos(res).map(mapearPerfil);
  }

  async obterPerfil(id: string): Promise<Perfil | undefined> {
    const res = await this.#db.query('SELECT * FROM conf_perfis WHERE id = ?', [id]);
    const linha = primeiraLinha(res);
    return linha ? mapearPerfil(linha) : undefined;
  }

  async atualizarFormUrl(perfilId: string, url: string): Promise<void> {
    await this.#db.exec(
      `UPDATE conf_perfis SET form_sheet_url = ? WHERE id = ?`,
      [url, perfilId],
    );
  }

  async salvarMapeamento(chave: string, mapa: MapeamentoColunas): Promise<void> {
    await this.#db.exec(
      `INSERT INTO conf_mapas (chave, mapa) VALUES (?, ?)
       ON CONFLICT(chave) DO UPDATE SET mapa = excluded.mapa`,
      [chave, JSON.stringify(mapa)],
    );
  }

  async obterMapeamento(chave: string): Promise<MapeamentoColunas | undefined> {
    const res = await this.#db.query('SELECT mapa FROM conf_mapas WHERE chave = ?', [chave]);
    const linha = primeiraLinha(res);
    if (!linha) return undefined;
    return parseJson<MapeamentoColunas>(comoTexto(linha['mapa']), {});
  }
}
