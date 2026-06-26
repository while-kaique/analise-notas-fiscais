/**
 * Entrypoint do Worker (GoDeploy / Cloudflare Workers) — a F6.
 *
 * `fetch`  → rotas HTTP (OAuth, criar job, progresso). Roteamento manual, sem framework.
 * `scheduled` → o cron avança os jobs em lotes (substitui o loop da `FilaEmMemoria`).
 *
 * Os arquivos estáticos da SPA (`src/web/*`) são servidos como assets pela plataforma;
 * aqui tratamos apenas `/api/*` e `/auth/*`.
 */
import { extrairSpreadsheetId } from '../sheets/spreadsheet-id.js';
import type { Env, ExecutionContext } from './env.js';
import {
  initSchema,
  salvarSessao,
  obterSessao,
  criarJob,
  obterJob,
  progressoJob,
} from './db.js';
import { sessaoDoRequest, selarSessao, cookieSessao, lerCookie } from './sessao.js';
import { GoogleAuthRest, obterEmail } from './google.js';
import { credenciaisApp, avancarJobs, novoJob } from './processar.js';

function json(dados: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function erro(mensagem: string, status: number): Response {
  return json({ erro: mensagem }, status);
}

function segredoSessao(env: Env): string {
  const s = env.SESSION_SECRET ?? '';
  if (!s) throw new Error('SESSION_SECRET não configurado (setAppSecret).');
  return s;
}

/**
 * Dispara o avanço dos jobs em background (`ctx.waitUntil`), **capturando** qualquer
 * rejeição e logando-a. Sem isso, uma falha em `avancarJobs` (ex.: DB/segredo ausente)
 * vira uma rejeição não-tratada que a plataforma reporta como `CronError: internal error`
 * — opaca, sem a mensagem real. Aqui o erro aparece nos logs do app (getAppLogs) e o
 * tick do cron ainda responde 202 (falha isolada, CLAUDE.md §3).
 */
function dispararAvanco(env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    avancarJobs(env).catch((e) => {
      console.error('avancarJobs falhou:', e instanceof Error ? (e.stack ?? e.message) : e);
    }),
  );
}

const COOKIE_STATE = 'nf_oauth_state';

/** GET /api/auth/google — inicia o consentimento OAuth. */
async function iniciarLogin(env: Env): Promise<Response> {
  const auth = new GoogleAuthRest(credenciaisApp(env));
  const state = crypto.randomUUID();
  const url = auth.getAuthUrl(state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': `${COOKIE_STATE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}

/** GET /auth/google/callback — troca o código, cria a sessão e volta para a SPA. */
async function callbackLogin(req: Request, env: Env, url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookie = lerCookie(req.headers.get('cookie'), COOKIE_STATE);
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return erro('Falha na validação do login (state inválido). Tente novamente.', 400);
  }

  const auth = new GoogleAuthRest(credenciaisApp(env));
  const tokens = await auth.exchangeCode(code);
  const email = await obterEmail(tokens.accessToken).catch(() => '');

  const id = crypto.randomUUID();
  await salvarSessao(env.DB, {
    id,
    email,
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    ...(tokens.expiraEmMs !== undefined ? { expiraEmMs: tokens.expiraEmMs } : {}),
  });

  const selado = await selarSessao(id, segredoSessao(env));
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': cookieSessao(selado),
    },
  });
}

/** GET /api/me — identidade da sessão atual. */
async function me(req: Request, env: Env): Promise<Response> {
  const id = await sessaoDoRequest(req, segredoSessao(env));
  if (!id) return erro('Não autenticado.', 401);
  const sessao = await obterSessao(env.DB, id);
  if (!sessao) return erro('Sessão expirada.', 401);
  return json({ email: sessao.email, autenticado: true });
}

/** POST /api/jobs — cria um job a partir do link (não confiável) da planilha. */
async function criarJobRota(req: Request, env: Env): Promise<Response> {
  const id = await sessaoDoRequest(req, segredoSessao(env));
  if (!id) return erro('Não autenticado.', 401);

  let corpo: { url?: unknown; aba?: unknown };
  try {
    corpo = (await req.json()) as { url?: unknown; aba?: unknown };
  } catch {
    return erro('Corpo inválido (esperado JSON).', 400);
  }

  const urlPlanilha = typeof corpo.url === 'string' ? corpo.url : '';
  const spreadsheetId = extrairSpreadsheetId(urlPlanilha);
  if (!spreadsheetId) {
    return erro('Link de planilha inválido. Cole a URL do Google Sheets.', 400);
  }
  const aba = typeof corpo.aba === 'string' && corpo.aba.trim() !== '' ? corpo.aba.trim() : undefined;

  const job = novoJob({
    id: crypto.randomUUID(),
    donoId: id,
    spreadsheetId,
    spreadsheetUrl: urlPlanilha,
    ...(aba ? { aba } : {}),
  });
  await criarJob(env.DB, job);
  return json({ jobId: job.id, status: job.status }, 201);
}

/** GET /api/jobs/:id — progresso agregado (a devolutiva na tela). */
async function progressoRota(req: Request, env: Env, jobId: string): Promise<Response> {
  const id = await sessaoDoRequest(req, segredoSessao(env));
  if (!id) return erro('Não autenticado.', 401);

  const job = await obterJob(env.DB, jobId);
  if (!job || job.donoId !== id) return erro('Job não encontrado.', 404);

  const progresso = await progressoJob(env.DB, jobId);
  if (!progresso) return erro('Job não encontrado.', 404);
  return json(progresso);
}

async function rotear(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const metodo = req.method.toUpperCase();

  await initSchema(env.DB);

  if (metodo === 'GET' && pathname === '/api/auth/google') return iniciarLogin(env);
  if (metodo === 'GET' && pathname === '/auth/google/callback') return callbackLogin(req, env, url);
  if (metodo === 'GET' && pathname === '/api/me') return me(req, env);
  if (metodo === 'POST' && pathname === '/api/jobs') return criarJobRota(req, env);

  const mJob = pathname.match(/^\/api\/jobs\/([A-Za-z0-9-]+)$/);
  if (metodo === 'GET' && mJob?.[1]) return progressoRota(req, env, mJob[1]);

  // Gatilho do CRON da plataforma (POST com header ASSINADO X-Godeploy-Cron).
  // O header é uma assinatura (não o valor cru de GODEPLOY_CRON_KEY), então exigimos
  // apenas sua PRESENÇA — chamadas externas não o trazem, e a visibilidade
  // `authenticated` do app já barra acesso anônimo. TODO (FUND): validar a assinatura
  // contra GODEPLOY_CRON_KEY quando o esquema de assinatura estiver documentado.
  if (metodo === 'POST' && pathname === '/tasks/processar') {
    const assinado = req.headers.get('x-godeploy-cron');
    if (env.GODEPLOY_CRON_KEY && !assinado) return erro('Cron não autorizado.', 401);
    dispararAvanco(env, ctx);
    return json({ ok: true }, 200);
  }

  // Gatilho manual de processamento (útil sem esperar o cron; protegido por sessão).
  if (metodo === 'POST' && pathname === '/api/processar') {
    const id = await sessaoDoRequest(req, segredoSessao(env));
    if (!id) return erro('Não autenticado.', 401);
    dispararAvanco(env, ctx);
    return json({ ok: true, mensagem: 'Processamento disparado.' }, 202);
  }

  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    return erro('Rota não encontrada.', 404);
  }

  // Não-API: a SPA estática (assets) responde. Se o Worker for invocado mesmo assim,
  // devolve um redirecionamento para a raiz (deep-link → SPA).
  return new Response(null, { status: 302, headers: { Location: '/' } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await rotear(req, env, ctx);
    } catch (e) {
      // Loga o erro real: sem isto, um throw em `rotear` (ex.: initSchema/DB,
      // segredo ausente) vira só um 500 opaco — e, num tick de cron, a plataforma
      // reporta `CronError: internal error` sem a mensagem. Não vaza PII (só o erro).
      console.error('worker fetch erro:', e instanceof Error ? (e.stack ?? e.message) : e);
      const msg = e instanceof Error ? e.message : 'Erro interno.';
      return erro(msg, 500);
    }
  },
  // O cron do GoDeploy NÃO é um handler `scheduled`: a plataforma faz POST em
  // /tasks/processar (ver rota acima). Não adicionar `scheduled`/setInterval aqui.
};
