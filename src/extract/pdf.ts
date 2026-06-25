/**
 * Borda de I/O: lê a **camada de texto** de um PDF via `pdf-parse`.
 *
 * Importa direto `pdf-parse/lib/pdf-parse.js` por `createRequire` para fugir do
 * bloco de debug que o `index.js` do pacote executa quando carregado como módulo
 * (tenta abrir um PDF de teste do próprio pacote). O cast tipa o retorno usado.
 */
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';

const require = createRequire(import.meta.url);

interface ResultadoPdfParse {
  text: string;
  numpages: number;
}
type PdfParse = (data: Buffer) => Promise<ResultadoPdfParse>;

const pdfParse = require('pdf-parse/lib/pdf-parse.js') as PdfParse;

/**
 * Extrai o texto embutido no PDF. Retorna string vazia quando o PDF é só imagem
 * (escaneado) — o orquestrador cai no OCR nesse caso. Nunca lança: erro de
 * parsing vira texto vazio (a cascata segue).
 */
export async function lerTextoPdf(bytes: Uint8Array): Promise<string> {
  try {
    const { text } = await pdfParse(Buffer.from(bytes));
    return text ?? '';
  } catch {
    return '';
  }
}
