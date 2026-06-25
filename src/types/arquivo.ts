/** Tipos de arquivo que o pipeline sabe (ou tenta) processar. */
export type TipoArquivo = 'pdf' | 'xml' | 'desconhecido';

/**
 * Arquivo já baixado em memória, pronto para extração.
 * `hash` é o SHA-256 (hex) do conteúdo — usado para cache de download/OCR
 * (ver CLAUDE.md §5: não reprocessar o mesmo arquivo à toa).
 */
export interface ArquivoBaixado {
  bytes: Uint8Array;
  /** Content-Type informado pela origem, quando houver. */
  contentType?: string;
  /** SHA-256 do conteúdo, em hexadecimal. */
  hash: string;
  /** Tipo detectado a partir do conteúdo/headers. */
  tipo: TipoArquivo;
  /** Tamanho em bytes. */
  tamanhoBytes: number;
}
