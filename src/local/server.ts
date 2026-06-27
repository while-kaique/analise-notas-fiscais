/**
 * Servidor de desenvolvimento LOCAL — roda o worker do GoDeploy em Node, com:
 *  - `env.DB` sobre `node:sqlite` (arquivo local persistente);
 *  - segredos via `process.env` (use `node --env-file=.env`);
 *  - assets da SPA (`src/web/`) servidos com fallback SPA;
 *  - um "cron" local que chama `avancarConfJobs` em intervalo fixo (mimetiza o GoDeploy);
 *  - logs bonitos no console (LOG_PRETTY) para `tail`/debug.
 *
 * NÃO faz parte do deploy (o bundle do worker parte de `dist/api/worker.js`, que não
 * importa este arquivo nem `node:*`). Subir com: `npm run dev`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import worker from '../api/worker.js';
import type { Env, ExecutionContext } from '../api/env.js';
import { criarDbSqlite } from './db-sqlite.js';
import { avancarConfJobs } from '../api/conferencia-processar.js';
import { log, configurarLog } from '../obs/log.js';

const PORTA = Number(process.env.PORT ?? 8787);
const CAMINHO_DB = process.env.LOCAL_DB ?? '.dev/local.db';
const INTERVALO_CRON_MS = Number(process.env.LOCAL_CRON_MS ?? 15000);
const DIR_WEB = join(process.cwd(), 'src', 'web');

// Defaults amigáveis p/ dev (sobrescrevíveis pelo .env / ambiente).
process.env.LOG_LEVEL ??= 'debug';
process.env.LOG_PRETTY ??= '1';
configurarLog({ level: process.env.LOG_LEVEL, pretty: true });

const DB = criarDbSqlite(CAMINHO_DB);

/** Monta o `Env` do worker a partir do ambiente do processo + o DB local. */
function montarEnv(): Env {
  return { ...(process.env as Record<string, string>), DB } as unknown as Env;
}

const TIPOS: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function tipoConteudo(arquivo: string): string {
  const ext = arquivo.slice(arquivo.lastIndexOf('.'));
  return TIPOS[ext] ?? 'application/octet-stream';
}

/** Converte a request do Node numa `Request` web (com corpo, se houver). */
async function comoRequestWeb(req: IncomingMessage): Promise<Request> {
  const url = `http://localhost:${PORTA}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  const metodo = req.method ?? 'GET';
  if (metodo === 'GET' || metodo === 'HEAD') {
    return new Request(url, { method: metodo, headers });
  }
  const partes: Buffer[] = [];
  for await (const chunk of req) partes.push(chunk as Buffer);
  return new Request(url, { method: metodo, headers, body: Buffer.concat(partes) });
}

/** Escreve uma `Response` web na resposta do Node. */
async function escreverResposta(resp: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(resp.status, headers);
  const buf = Buffer.from(await resp.arrayBuffer());
  res.end(buf);
}

/** Serve um asset estático da SPA; devolve `true` se respondeu. */
async function servirAsset(caminho: string, res: ServerResponse): Promise<boolean> {
  const rel = caminho === '/' ? 'index.html' : caminho.replace(/^\/+/, '');
  const alvo = normalize(join(DIR_WEB, rel));
  if (!alvo.startsWith(DIR_WEB)) return false; // path traversal
  try {
    const conteudo = await readFile(alvo);
    res.writeHead(200, { 'content-type': tipoConteudo(alvo) });
    res.end(conteudo);
    return true;
  } catch {
    return false;
  }
}

async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const caminho = (req.url ?? '/').split('?')[0] ?? '/';
  const ehWorker = caminho.startsWith('/api') || caminho.startsWith('/tasks');

  if (!ehWorker && req.method === 'GET') {
    if (await servirAsset(caminho, res)) return;
    // Fallback SPA: rota desconhecida → index.html.
    if (await servirAsset('/', res)) return;
  }

  const pendentes: Promise<unknown>[] = [];
  const ctx: ExecutionContext = { waitUntil: (p) => void pendentes.push(p) };
  try {
    const resp = await worker.fetch(await comoRequestWeb(req), montarEnv(), ctx);
    await escreverResposta(resp, res);
  } catch (e) {
    log.error('server: erro ao tratar request', { path: caminho, erro: e instanceof Error ? e.message : String(e) });
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Erro interno do servidor local.' }));
  }
  // Espera o trabalho de fundo (ctx.waitUntil) — assim o processamento e seus logs saem.
  await Promise.allSettled(pendentes);
}

// ──────────────────────────── Cron local ────────────────────────────
let rodandoCron = false;
async function tickCron(): Promise<void> {
  if (rodandoCron) return; // evita sobreposição
  rodandoCron = true;
  try {
    await avancarConfJobs(montarEnv());
  } catch (e) {
    log.error('cron local falhou', { erro: e instanceof Error ? e.message : String(e) });
  } finally {
    rodandoCron = false;
  }
}

createServer((req, res) => void tratar(req, res)).listen(PORTA, () => {
  log.info('servidor local no ar', { url: `http://localhost:${PORTA}`, db: CAMINHO_DB, cronMs: INTERVALO_CRON_MS });
});
setInterval(() => void tickCron(), INTERVALO_CRON_MS);
