/**
 * `RepositorioPerfis` **em memória**, semeado com {@link MARCAS_SEED}/{@link PERFIS_SEED}.
 * Para dev e testes. A implementação de produção (sobre `env.DB`) entra na fatia C5 —
 * o schema correspondente está em `../persistencia/schema.ts`.
 */
import type {
  Marca,
  Perfil,
  MapeamentoColunas,
} from '../tipos.js';
import type { RepositorioPerfis } from '../contratos.js';
import { MARCAS_SEED, PERFIS_SEED } from './seed.js';

function clonar<T>(valor: T): T {
  return structuredClone(valor);
}

export class RepositorioPerfisMemoria implements RepositorioPerfis {
  private readonly marcas = new Map<string, Marca>();
  private readonly perfis = new Map<string, Perfil>();
  private readonly mapeamentos = new Map<string, MapeamentoColunas>();

  constructor(
    marcas: readonly Marca[] = MARCAS_SEED,
    perfis: readonly Perfil[] = PERFIS_SEED,
  ) {
    for (const m of marcas) this.marcas.set(m.id, clonar(m));
    for (const p of perfis) this.perfis.set(p.id, clonar(p));
  }

  listarMarcas(): Promise<Marca[]> {
    return Promise.resolve([...this.marcas.values()].map(clonar));
  }

  obterMarca(id: string): Promise<Marca | undefined> {
    const m = this.marcas.get(id);
    return Promise.resolve(m ? clonar(m) : undefined);
  }

  listarPerfis(marcaId?: string): Promise<Perfil[]> {
    const todos = [...this.perfis.values()];
    const filtrados = marcaId ? todos.filter((p) => p.marcaId === marcaId) : todos;
    return Promise.resolve(filtrados.map(clonar));
  }

  obterPerfil(id: string): Promise<Perfil | undefined> {
    const p = this.perfis.get(id);
    return Promise.resolve(p ? clonar(p) : undefined);
  }

  // `async` de propósito: um throw vira Promise rejeitada (não erro síncrono),
  // respeitando o contrato `Promise<void>` de `RepositorioPerfis`.
  async atualizarFormUrl(perfilId: string, url: string): Promise<void> {
    const p = this.perfis.get(perfilId);
    if (!p) throw new Error(`Perfil não encontrado: ${perfilId}`);
    this.perfis.set(perfilId, { ...p, formSheetUrl: url });
  }

  async salvarMapeamento(perfilId: string, mapa: MapeamentoColunas): Promise<void> {
    if (!this.perfis.has(perfilId)) {
      throw new Error(`Perfil não encontrado: ${perfilId}`);
    }
    this.mapeamentos.set(perfilId, clonar(mapa));
  }

  obterMapeamento(perfilId: string): Promise<MapeamentoColunas | undefined> {
    const m = this.mapeamentos.get(perfilId);
    return Promise.resolve(m ? clonar(m) : undefined);
  }
}
