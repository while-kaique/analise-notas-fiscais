/**
 * Interfaces de camada da **Conferência de NF por Cupom** (v2).
 *
 * São os **contratos** que as fatias C1–C6 implementam (uma por worktree). I/O fica
 * atrás destas interfaces para o orquestrador permanecer fino e testável com fakes
 * (CLAUDE.md §3/§7). Nenhuma implementação concreta aqui.
 */
import type { ArquivoBaixado } from '../types/arquivo.js';
import type {
  Marca,
  Perfil,
  PlanilhaRef,
  ColunasSaida,
  CamposNfBrutos,
  MapeamentoColunas,
  PapelColunaEntrada,
} from './tipos.js';

// ───────────────────────────── Planilhas (leitura/escrita) ─────────────────────────────

/** Uma linha de dados da planilha, com os valores indexados por **cabeçalho**. */
export interface RegistroPlanilha {
  /** Número da linha na planilha (1-based, como o usuário vê). */
  numeroLinha: number;
  /** Cabeçalho → valor (string crua da célula). */
  valores: Readonly<Record<string, string>>;
}

/** Uma célula a escrever (identificada por cabeçalho, nunca por índice). */
export interface EscritaCelula {
  numeroLinha: number;
  coluna: string;
  valor: string;
}

/**
 * I/O de planilha para a conferência (implementação C5, sobre o `SheetsClient`
 * Workers-native do v1). Lê registros por cabeçalho e escreve em lote (`batchUpdate`).
 */
export interface LeitorPlanilha {
  lerCabecalho(ref: PlanilhaRef): Promise<string[]>;
  lerRegistros(ref: PlanilhaRef): Promise<RegistroPlanilha[]>;
  /** Cria as colunas que não existirem (CLAUDE.md §4 — nunca destrói dados). */
  garantirColunas(ref: PlanilhaRef, colunas: readonly string[]): Promise<void>;
  /** Escreve as células em **lote**. */
  escrever(ref: PlanilhaRef, escritas: readonly EscritaCelula[]): Promise<void>;
}

// ───────────────────────────────── LLM (AI Proxy) ──────────────────────────────────────

export type PapelMensagem = 'system' | 'user' | 'assistant';

export interface MensagemLlm {
  role: PapelMensagem;
  content: string;
}

export interface OpcoesLlm {
  temperature?: number;
  maxTokens?: number;
  /** `response_format: json_object`. */
  jsonMode?: boolean;
  /** Sobrescreve `LLM_MODEL` para esta chamada. */
  model?: string;
}

/**
 * Cliente do **GoGroup AI Proxy** (gateway OpenAI-compatível). Implementação C3
 * (porte de `godocs-main/src/lib/llm.ts`, só `fetch`). Usado por `ExtratorCampos` e
 * `MapeadorColunas`.
 */
export interface ClienteLlm {
  chat(mensagens: readonly MensagemLlm[], opts?: OpcoesLlm): Promise<string>;
}

// ──────────────────────────── Extração de campos da NF (IA) ────────────────────────────

/** Extrai os campos da NF do texto do OCR (implementação C3, prompt verbatim — spec §5.4). */
export interface ExtratorCampos {
  extrair(textoNf: string): Promise<CamposNfBrutos>;
}

// ───────────────────────────── Mapeamento de colunas (IA) ──────────────────────────────

/** Entrada do mapeador: o cabeçalho real + exemplos + os papéis que a frente precisa. */
export interface EntradaMapeamento {
  cabecalhos: readonly string[];
  /** Coluna → alguns valores de exemplo (ajuda a desambiguar). */
  exemplos?: Readonly<Record<string, readonly string[]>>;
  papeisEntrada: readonly PapelColunaEntrada[];
  papeisSaida: readonly (keyof ColunasSaida)[];
}

/** Mapeia cabeçalho → papéis (implementação C2, sobre o AI Proxy — spec §6). */
export interface MapeadorColunas {
  mapear(entrada: EntradaMapeamento): Promise<MapeamentoColunas>;
}

// ──────────────────────────────── Download (Drive) ─────────────────────────────────────

/**
 * Baixa o arquivo da NF a partir do link do formulário (implementação C4). O caminho
 * principal é o **Google Drive** (OAuth + `drive.readonly`); link não-Drive cai no
 * `FileFetcherWorkers` (SSRF guard) como fallback.
 */
export interface BaixadorNf {
  baixar(link: string): Promise<ArquivoBaixado>;
}

// ─────────────────────────────── Repositório de perfis ─────────────────────────────────

/**
 * Persistência de marcas/perfis e do cache de mapeamento (implementação em `env.DB`
 * na C5; uma impl em memória, semeada, já existe na C0 para dev/testes).
 */
export interface RepositorioPerfis {
  listarMarcas(): Promise<Marca[]>;
  obterMarca(id: string): Promise<Marca | undefined>;
  listarPerfis(marcaId?: string): Promise<Perfil[]>;
  obterPerfil(id: string): Promise<Perfil | undefined>;
  /** Salva o link do formulário do mês (substitui o anterior — decisão 4). */
  atualizarFormUrl(perfilId: string, url: string): Promise<void>;
  /** Cache do mapa de colunas por perfil (formato estável — spec §6). */
  salvarMapeamento(perfilId: string, mapa: MapeamentoColunas): Promise<void>;
  obterMapeamento(perfilId: string): Promise<MapeamentoColunas | undefined>;
}
