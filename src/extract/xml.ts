/**
 * Extração a partir do **XML da NF-e** — a fonte mais confiável (CLAUDE.md §1).
 *
 * O parsing é puro e determinístico: recebe a string do XML e devolve campos
 * brutos (strings), sem normalizar. A normalização/validação fica em `montar.ts`.
 *
 * Robustez: NF-e, NFC-e e NFS-e variam no aninhamento (com/sem `nfeProc`, layout
 * municipal etc.). Em vez de assumir um caminho fixo, busca tags por **nome**
 * (case-insensitive) na árvore, preferindo a ocorrência mais externa.
 */
import { XMLParser } from 'fast-xml-parser';
import type { CamposBrutos } from './montar.js';

// parseTagValue/parseAttributeValue desligados: mantém tudo como string para não
// perder zeros à esquerda de CNPJ nem reformatar valores (ex.: "1234.56").
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

type No = Record<string, unknown>;

const ehObjeto = (v: unknown): v is No => typeof v === 'object' && v !== null;

/**
 * Busca, em profundidade, o primeiro valor sob qualquer um dos nomes de tag
 * informados (case-insensitive), preferindo correspondências mais externas.
 */
function buscarNo(raiz: unknown, nomes: readonly string[]): unknown {
  const alvos = new Set(nomes.map((n) => n.toLowerCase()));
  let achado: unknown;

  const visitar = (no: unknown): boolean => {
    if (!ehObjeto(no)) return false;
    if (Array.isArray(no)) {
      for (const item of no) if (visitar(item)) return true;
      return false;
    }
    // Correspondência neste nível primeiro (prefere o mais externo).
    for (const [chave, valor] of Object.entries(no)) {
      if (alvos.has(chave.toLowerCase())) {
        achado = valor;
        return true;
      }
    }
    for (const valor of Object.values(no)) {
      if (visitar(valor)) return true;
    }
    return false;
  };

  visitar(raiz);
  return achado;
}

/** Converte o resultado de uma tag (string, número, ou nó com `#text`) em texto. */
function comoTexto(valor: unknown): string | undefined {
  if (typeof valor === 'string') return valor.trim() || undefined;
  if (typeof valor === 'number') return String(valor);
  if (ehObjeto(valor) && !Array.isArray(valor)) {
    const t = valor['#text'];
    if (typeof t === 'string') return t.trim() || undefined;
    if (typeof t === 'number') return String(t);
  }
  return undefined;
}

const buscarTexto = (raiz: unknown, nomes: readonly string[]): string | undefined =>
  comoTexto(buscarNo(raiz, nomes));

/** Lê o atributo `Id`/`chNFe` de um nó (chave de acesso da NF-e). */
function lerAtributoId(no: unknown): string | undefined {
  if (!ehObjeto(no)) return undefined;
  const id = no['@_Id'] ?? no['@_id'] ?? no['@_Id'.toLowerCase()];
  return typeof id === 'string' ? id : undefined;
}

/**
 * Extrai campos brutos do XML. Retorna `null` quando o conteúdo não é um XML
 * parseável (para a cascata cair na próxima fonte).
 */
export function extrairCamposDeXml(xml: string): CamposBrutos | null {
  let raiz: unknown;
  try {
    raiz = parser.parse(xml);
  } catch {
    return null;
  }
  if (!ehObjeto(raiz)) return null;

  // Emitente (NF-e: emit · NFS-e: Prestador/PrestadorServico).
  const emit = buscarNo(raiz, ['emit', 'prestador', 'prestadorservico', 'prestadorServico']);
  const cnpjEmitente =
    buscarTexto(emit, ['CNPJ', 'Cnpj']) ?? buscarTexto(emit, ['CPF', 'Cpf']);
  const razaoSocialEmitente = buscarTexto(emit, ['xNome', 'RazaoSocial', 'razaoSocial', 'xFant']);

  // Destinatário (NF-e: dest · NFS-e: Tomador/TomadorServico).
  const dest = buscarNo(raiz, ['dest', 'tomador', 'tomadorservico', 'tomadorServico']);
  const documentoDestinatario =
    buscarTexto(dest, ['CNPJ', 'Cnpj']) ?? buscarTexto(dest, ['CPF', 'Cpf']);

  // Identificação / datas.
  const ide = buscarNo(raiz, ['ide']) ?? raiz;
  const dataEmissao =
    buscarTexto(ide, ['dhEmi', 'dEmi']) ??
    buscarTexto(raiz, ['DataEmissao', 'dataEmissao', 'dhEmi', 'dEmi', 'dhRecbto']);
  const numero = buscarTexto(ide, ['nNF', 'Numero', 'numero']);
  const serie = buscarTexto(ide, ['serie', 'Serie']);

  // Valor total (NF-e: total/ICMSTot/vNF · NFS-e: vários nomes municipais).
  const valorTotal = buscarTexto(raiz, [
    'vNF',
    'ValorLiquidoNfse',
    'ValorTotalNota',
    'ValorServicos',
    'valorServicos',
    'vServ',
  ]);

  // Chave de acesso: atributo Id do infNFe/infNfse, ou tag <chNFe>.
  const infNFe = buscarNo(raiz, ['infNFe', 'infNfse', 'InfNfse']);
  const chaveAcesso = lerAtributoId(infNFe) ?? buscarTexto(raiz, ['chNFe', 'chaveAcesso']);

  // Se nada de relevante foi achado, trata como "não é nota" → cascata segue.
  const achouAlgo = cnpjEmitente ?? dataEmissao ?? valorTotal ?? chaveAcesso;
  if (achouAlgo === undefined) return null;

  return {
    ...(cnpjEmitente !== undefined ? { cnpjEmitente } : {}),
    ...(razaoSocialEmitente !== undefined ? { razaoSocialEmitente } : {}),
    ...(documentoDestinatario !== undefined ? { documentoDestinatario } : {}),
    ...(dataEmissao !== undefined ? { dataEmissao } : {}),
    ...(valorTotal !== undefined ? { valorTotal } : {}),
    ...(numero !== undefined ? { numero } : {}),
    ...(serie !== undefined ? { serie } : {}),
    ...(chaveAcesso !== undefined ? { chaveAcesso } : {}),
  };
}
