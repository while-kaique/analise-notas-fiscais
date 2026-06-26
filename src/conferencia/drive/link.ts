/**
 * Extração **pura** do fileId de um link de arquivo do Google Drive.
 *
 * O formulário do Google guarda a NF como arquivo do Drive; o link vem em formatos
 * variados (o n8n só fazia `open?id=`→`file/d/`). Aqui cobrimos os principais:
 * - `https://drive.google.com/open?id=FILEID`
 * - `https://drive.google.com/file/d/FILEID/view?...`
 * - `https://drive.google.com/uc?id=FILEID&export=download`
 * - `https://docs.google.com/.../d/FILEID/edit`
 * - um fileId "cru" (sem URL).
 */

/** Caracteres válidos em um fileId do Drive. */
const FILE_ID = '[A-Za-z0-9_-]';

/** `…/d/FILEID` ou `…/file/d/FILEID` (com ou sem segmento seguinte). */
const RE_PATH = new RegExp(`/(?:file/)?d/(${FILE_ID}{10,})`);
/** `?id=FILEID` ou `&id=FILEID`. */
const RE_QUERY = new RegExp(`[?&]id=(${FILE_ID}{10,})`);
/** O link inteiro é um fileId cru (≥ 20 chars para evitar falsos positivos). */
const RE_BARE = new RegExp(`^${FILE_ID}{20,}$`);

/** Devolve o fileId do Drive, ou `null` se o link não for reconhecido como Drive. */
export function extrairFileIdDrive(link: string): string | null {
  if (typeof link !== 'string') return null;
  const s = link.trim();
  if (s === '') return null;

  const porPath = RE_PATH.exec(s);
  if (porPath) return porPath[1] ?? null;

  const porQuery = RE_QUERY.exec(s);
  if (porQuery) return porQuery[1] ?? null;

  if (RE_BARE.test(s)) return s;

  return null;
}

/** `true` se o link aparenta ser um arquivo do Google Drive/Docs. */
export function ehLinkDrive(link: string): boolean {
  if (extrairFileIdDrive(link) === null) return false;
  // fileId cru não tem host; trata como Drive. URLs precisam ser de domínio Google.
  return !/^https?:\/\//i.test(link) || /(?:drive|docs)\.google\.com/i.test(link);
}
