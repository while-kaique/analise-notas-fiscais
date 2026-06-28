/**
 * Tipos do domínio **Conferência de NF por Cupom** (v2 — migração do n8n).
 *
 * Ver `spec-docs/SPEC_CONFERENCIA_V2.md` (fonte de verdade da regra de negócio em §4).
 * Convenções (CLAUDE.md §5): valores em **centavos** (inteiro), datas **ISO 8601**,
 * CNPJ/CPF **só dígitos**. A formatação para reais / `DD/MM/YYYY` é só na escrita da planilha.
 */

// ─────────────────────────────── Marca / Perfil / Frente ──────────────────────────────

/** As quatro frentes do fluxo (spec §3/§4). */
export type TipoFrente = 'INFLUS' | 'ASSESSORIA' | 'EMBAIXADOR' | 'SOMA';

/** Qual coluna de link da NF a frente consome no formulário. SOMA não baixa NF. */
export type PapelLinkNf = 'influencer' | 'assessoria' | 'unica';

/** Referência a uma aba de planilha. `aba` é o nome OU o gid (como string). */
export interface PlanilhaRef {
  spreadsheetId: string;
  aba: string;
}

/**
 * Nomes (cabeçalhos) das colunas que uma frente **escreve** no formulário.
 * Identificadas/escritas por cabeçalho, nunca por índice (CLAUDE.md §4). Configurável
 * por frente; defaults padronizados em `perfis/seed.ts` (spec §4.5).
 */
export interface ColunasSaida {
  status: string;
  cnpjTomador: string;
  valorNf: string;
  retroativo: string;
  /** Valor esperado vindo da base (n8n: `ValorPlanilha`). */
  valorEsperado: string;
  /** Esperado + retroativo (n8n: `ValorTotal_*`). */
  valorTotal: string;
  dataNf: string;
  numeroNf: string;
}

/** Uma frente dentro de um perfil. */
export interface Frente {
  tipo: TipoFrente;
  /** Coluna de link da NF (ausente em SOMA). */
  papelLinkNf?: PapelLinkNf;
  /** Cupons a ignorar nesta frente (exclusões do n8n; CASE-insensitive após normalizar). */
  exclusoesCupom: readonly string[];
  /** Colunas de saída (ausente em SOMA — escreve nos status de INFLUS e ASSESSORIA). */
  colunasSaida?: ColunasSaida;
}

/** Configuração por marca (Gocase, Gobeaute, …). */
export interface Marca {
  id: string;
  nome: string;
  /** CNPJ do tomador do serviço (a própria marca), só dígitos. */
  cnpjTomador: string;
  /** Status que, no histórico de retroativo, **param** a acumulação (spec §4.4). */
  statusBloqueantes: readonly string[];
  /** Diferença máxima (centavos) para classificar como "Parcial" (spec §2.5). Default 3000 = R$30. */
  margemParcialCentavos: number;
}

/**
 * Um perfil = uma marca + uma base fixa + um formulário (link trocado a cada mês) +
 * o conjunto de frentes que rodam sobre esse formulário (spec §3, decisão 4).
 */
export interface Perfil {
  id: string;
  marcaId: string;
  nome: string;
  /** Planilha-base (CONTROLE) — fixa. */
  base: PlanilhaRef;
  /** Link do Sheets de respostas do formulário do mês (salvo/atualizado a cada mês). */
  formSheetUrl?: string;
  frentes: readonly Frente[];
}

// ───────────────────────────── Mapeamento de colunas (IA) ─────────────────────────────

/** Papéis de **entrada** que a IA precisa localizar no cabeçalho do formulário (spec §6). */
export type PapelColunaEntrada =
  | 'cupom'
  | 'linkNf_influencer'
  | 'linkNf_assessoria'
  | 'linkNf_unica'
  | 'carimbo';

/** Um papel mapeado para uma coluna concreta, com confiança em [0,1]. */
export interface ColunaMapeada {
  /** Nome exato do cabeçalho na planilha. */
  coluna: string;
  /** Confiança da IA, 0..1. */
  confianca: number;
}

/** Mapa `papel → coluna` produzido pela IA (e cacheado no perfil). */
export type MapeamentoColunas = Partial<Record<string, ColunaMapeada>>;

// ─────────────────────────── Extração de campos da NF (IA) ───────────────────────────

/** Saída crua do AI Proxy (modo JSON, prompt verbatim do n8n — spec §5.4). */
export interface CamposNfBrutos {
  /** CNPJ do emissor/prestador (com ou sem máscara). */
  CNPJ1?: string;
  /** Valor líquido (número ou string). */
  Valor?: number | string;
  /** CNPJ do tomador (com ou sem máscara). */
  CNPJ2?: string;
  /** Data de emissão `DD/MM/YYYY`. */
  data_emissao?: string;
  /** Número da nota. */
  num_nota?: string;
}

/** Campos da NF já normalizados (centavos, ISO, só dígitos). */
export interface CamposNf {
  cnpjEmitente?: string;
  cnpjTomador?: string;
  valorCentavos?: number;
  dataEmissaoIso?: string;
  numeroNf?: string;
}

// ─────────────────────────────── Status e resultados ──────────────────────────────────

/**
 * Status por linha conferida (spec §2.5). Os três primeiros vêm da comparação de valor;
 * os demais são situações especiais que não chegam a comparar.
 */
export type StatusConferencia =
  | 'APROVADO'
  | 'PARCIAL'
  | 'NAO_APROVADO'
  | 'SEM_NF'
  | 'NAO_LEGIVEL'
  | 'CNPJ_DIFERENTE'
  | 'SEM_BASE';

/** Rótulos em PT-BR escritos na planilha (a superfície que o usuário lê). */
export const ROTULO_STATUS: Readonly<Record<StatusConferencia, string>> = {
  APROVADO: 'Aprovado',
  PARCIAL: 'Parcial',
  NAO_APROVADO: 'Não Aprovado',
  SEM_NF: 'Sem NF anexada',
  NAO_LEGIVEL: 'Não foi possível ler a NF',
  CNPJ_DIFERENTE: 'CNPJ diferente',
  SEM_BASE: 'Cupom não encontrado na base',
} as const;

/**
 * Uma linha pronta para conferir: resposta do formulário (cupom + link da NF) já
 * cruzada com a base (valor esperado + mês), após normalização/filtro/merge (spec §4.1).
 */
export interface LinhaConferencia {
  /** Cupom normalizado (UPPER, sem espaços) — chave do merge. */
  cupom: string;
  /** Cupom como o usuário digitou (escrito de volta na planilha). */
  cupomOriginal: string;
  /** Link da NF no Drive (vazio = "Sem NF anexada"). */
  linkNf: string;
  /** Valor esperado da base, em centavos. */
  valorEsperadoCentavos: number;
  /** Mês/Ano alvo da base (`MM/YYYY`). */
  mesAno: string;
  /** ID da linha na base (coluna `ID`), se houver. */
  idBase?: string;
  /** Carimbo de data/hora da resposta, se houver. */
  carimbo?: string;
}

/** Resultado da conferência de uma linha (vira escrita no formulário). */
export interface ResultadoConferencia {
  cupom: string;
  cupomOriginal: string;
  status: StatusConferencia;
  cnpjTomador?: string;
  valorNfCentavos?: number;
  valorEsperadoCentavos: number;
  retroativoCentavos: number;
  valorTotalCentavos: number;
  dataNfIso?: string;
  numeroNf?: string;
  /** Meses usados na acumulação retroativa (`MM/YYYY`), do mais recente p/ o mais antigo. */
  mesesRetroativos?: readonly string[];
  /** Mensagem acionável quando algo falhou (link morto, OCR, etc.). */
  erro?: string;
}

/** Uma entrada do histórico da base para um cupom (spec §4.4). */
export interface EntradaHistorico {
  mesAno: string;
  valorCentavos: number;
  status: string;
}

/** Resultado da reconciliação por soma (influ + assessoria) — spec §4.6. */
export interface ResultadoSoma {
  cupom: string;
  status: StatusConferencia;
  somaCentavos: number;
  valorEsperadoCentavos: number;
}
