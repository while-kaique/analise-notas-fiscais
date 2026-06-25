import type { TipoArquivo } from '../types/index.js';

/**
 * Detecção **pura** do tipo de arquivo a partir do conteúdo e/ou do
 * `Content-Type`. Prioriza o conteúdo (assinatura/magic bytes) sobre o header,
 * porque a origem pode mentir no `Content-Type`. A fonte da nota é PDF ou XML
 * (CLAUDE.md §1); qualquer outra coisa vira `desconhecido`.
 */

/** Lê os primeiros bytes como texto ASCII, ignorando espaços/BOM iniciais. */
function inicioComoTexto(bytes: Uint8Array, max = 512): string {
  const fatia = bytes.subarray(0, max);
  let texto = '';
  for (const b of fatia) texto += String.fromCharCode(b);
  return texto;
}

/** Detecta PDF pela assinatura `%PDF-` (pode haver lixo/BOM antes em PDFs ruins). */
function pareceePdf(bytes: Uint8Array): boolean {
  const inicio = inicioComoTexto(bytes, 1024);
  return inicio.includes('%PDF-');
}

/** Detecta XML por declaração `<?xml`, BOM+`<` ou raiz típica de NF-e. */
function pareceeXml(bytes: Uint8Array): boolean {
  const inicio = inicioComoTexto(bytes, 1024).replace(/^[﻿\s]+/, '');
  if (inicio.startsWith('<?xml')) return true;
  if (/^<(nfeProc|NFe|nfeProc|CFe|cteProc|consSitNFe|enviNFe)\b/i.test(inicio)) {
    return true;
  }
  // Heurística genérica: começa com '<' e contém '>' logo em seguida.
  return /^<[a-zA-Z!?]/.test(inicio);
}

function tipoPeloContentType(contentType: string | undefined): TipoArquivo | null {
  if (!contentType) return null;
  const ct = contentType.toLowerCase();
  if (ct.includes('application/pdf')) return 'pdf';
  if (ct.includes('xml')) return 'xml'; // application/xml, text/xml, .../...+xml
  return null;
}

/**
 * Determina o {@link TipoArquivo}: primeiro pela assinatura do conteúdo,
 * depois pelo `Content-Type`. `desconhecido` quando nada bate (o pipeline
 * decide se tenta extrair mesmo assim).
 */
export function detectarTipo(
  bytes: Uint8Array,
  contentType?: string,
): TipoArquivo {
  if (pareceePdf(bytes)) return 'pdf';
  if (pareceeXml(bytes)) return 'xml';
  const porHeader = tipoPeloContentType(contentType);
  if (porHeader) return porHeader;
  return 'desconhecido';
}
