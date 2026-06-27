/**
 * Entrypoint do Worker (GoDeploy / Cloudflare Workers) — v2 · Conferência por Cupom (C6).
 *
 * `fetch` → rotas HTTP da conferência (perfis, iniciar, progresso, confirmar mapa).
 * O **cron** do GoDeploy faz `POST /tasks/processar` (header assinado `X-Godeploy-Cron`),
 * que avança os jobs em lote (`avancarConfJobs`). Roteamento manual, sem framework.
 *
 * **Sem login Google na UI** (decisão 11): o acesso é gated pelo GoDeploy
 * (`visibility: authenticated`, só gocase). A identidade que acessa Drive/Sheets é a
 * `rpa_ia` via refresh token (ver `conferencia-deps.ts`). Os arquivos estáticos da SPA
 * (`src/web/*`) são servidos como assets pela plataforma; aqui tratamos só `/api/*` e `/tasks/*`.
 */
import type { Env, ExecutionContext } from './env.js';
import { montarRepo } from './conferencia-deps.js';
import {
  avancarConfJobs,
  criarConferencia,
  confirmarMapeamento,
} from './conferencia-processar.js';
import { progressoConfJob, lerAtividades } from '../conferencia/persistencia/jobs-db.js';
import type { TipoFrente } from '../conferencia/index.js';
import { log, configurarLog, msgErro, stackErro } from '../obs/log.js';

function json(dados: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function erro(mensagem: string, status: number): Response {
  return json({ erro: mensagem }, status);
}

/**
 * Dispara o avanço dos jobs em background (`ctx.waitUntil`), capturando e logando
 * qualquer rejeição — sem isto uma falha viraria `CronError: internal error` opaca.
 * Não vaza PII (só a mensagem de erro).
 */
function dispararAvanco(env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    avancarConfJobs(env).catch((e) => {
      log.error('avancarConfJobs falhou', { erro: stackErro(e) });
    }),
  );
}

/** GET /api/perfis — perfis disponíveis (marca + frentes + link do form atual). */
async function listarPerfisRota(env: Env): Promise<Response> {
  const repo = montarRepo(env);
  await repo.inicializar();
  const [marcas, perfis] = await Promise.all([repo.listarMarcas(), repo.listarPerfis()]);
  const nomeMarca = new Map(marcas.map((m) => [m.id, m.nome]));
  const view = perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    marca: { id: p.marcaId, nome: nomeMarca.get(p.marcaId) ?? p.marcaId },
    frentes: p.frentes.map((f) => f.tipo),
    formSheetUrl: p.formSheetUrl ?? '',
    // Gobeaute é esqueleto (spec §3/§10): sem base configurada ainda.
    baseConfigurada: p.base.spreadsheetId.trim() !== '',
  }));
  return json({ perfis: view });
}

/** POST /api/conferencias — inicia uma conferência (perfil + mês + link do formulário). */
async function iniciarRota(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let corpo: { perfilId?: unknown; mesAlvo?: unknown; formUrl?: unknown };
  try {
    corpo = (await req.json()) as typeof corpo;
  } catch {
    return erro('Corpo inválido (esperado JSON).', 400);
  }
  const perfilId = typeof corpo.perfilId === 'string' ? corpo.perfilId : '';
  const mesAlvo = typeof corpo.mesAlvo === 'string' ? corpo.mesAlvo : '';
  const formUrl = typeof corpo.formUrl === 'string' ? corpo.formUrl : '';

  let resultado: { jobId: string };
  try {
    resultado = await criarConferencia(env, { perfilId, mesAlvo, formUrl });
  } catch (e) {
    return erro(e instanceof Error ? e.message : 'Falha ao iniciar a conferência.', 400);
  }
  dispararAvanco(env, ctx); // começa já, sem esperar o cron
  return json({ jobId: resultado.jobId, status: 'CRIADO' }, 201);
}

/** GET /api/conferencias/:id — progresso agregado (a devolutiva na tela). */
async function progressoRota(env: Env, jobId: string): Promise<Response> {
  const progresso = await progressoConfJob(env.DB, jobId);
  if (!progresso) return erro('Conferência não encontrada.', 404);
  return json(progresso);
}

/** GET /api/conferencias/:id/atividades — feed incremental p/ a tela "rolando". */
async function atividadesRota(env: Env, jobId: string, url: URL): Promise<Response> {
  const desde = Number(url.searchParams.get('desde') ?? '0');
  const cursor = Number.isFinite(desde) && desde > 0 ? Math.trunc(desde) : 0;
  const atividades = await lerAtividades(env.DB, jobId, cursor);
  const ultimoId = atividades.length > 0 ? atividades[atividades.length - 1]!.id : cursor;
  return json({ atividades, ultimoId });
}

/** POST /api/conferencias/:id/mapeamento — confirma o mapa de colunas e religa o job. */
async function confirmarRota(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  jobId: string,
): Promise<Response> {
  let corpo: { frente?: unknown; mapeamento?: unknown };
  try {
    corpo = (await req.json()) as typeof corpo;
  } catch {
    return erro('Corpo inválido (esperado JSON).', 400);
  }
  const frente = typeof corpo.frente === 'string' ? (corpo.frente as TipoFrente) : undefined;
  const mapeamento =
    corpo.mapeamento && typeof corpo.mapeamento === 'object'
      ? (corpo.mapeamento as Record<string, string>)
      : undefined;
  if (!frente || !mapeamento) {
    return erro('Informe "frente" e "mapeamento" { papel: coluna }.', 400);
  }

  try {
    await confirmarMapeamento(env, jobId, { frente, mapeamento });
  } catch (e) {
    return erro(e instanceof Error ? e.message : 'Falha ao confirmar o mapeamento.', 400);
  }
  dispararAvanco(env, ctx);
  return json({ ok: true }, 200);
}

async function rotear(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const metodo = req.method.toUpperCase();

  if (metodo === 'GET' && pathname === '/api/perfis') return listarPerfisRota(env);
  if (metodo === 'POST' && pathname === '/api/conferencias') return iniciarRota(req, env, ctx);

  const mAtv = pathname.match(/^\/api\/conferencias\/([A-Za-z0-9-]+)\/atividades$/);
  if (metodo === 'GET' && mAtv?.[1]) return atividadesRota(env, mAtv[1], url);

  const mConf = pathname.match(/^\/api\/conferencias\/([A-Za-z0-9-]+)$/);
  if (metodo === 'GET' && mConf?.[1]) return progressoRota(env, mConf[1]);

  const mMapa = pathname.match(/^\/api\/conferencias\/([A-Za-z0-9-]+)\/mapeamento$/);
  if (metodo === 'POST' && mMapa?.[1]) return confirmarRota(req, env, ctx, mMapa[1]);

  // Gatilho do CRON da plataforma (POST com header assinado X-Godeploy-Cron). O header
  // é uma assinatura (não o valor cru), então exigimos só sua PRESENÇA quando há chave
  // configurada — chamadas externas não o trazem, e a visibilidade `authenticated` do
  // app já barra acesso anônimo.
  if (metodo === 'POST' && pathname === '/tasks/processar') {
    const assinado = req.headers.get('x-godeploy-cron');
    if (env.GODEPLOY_CRON_KEY && !assinado) return erro('Cron não autorizado.', 401);
    dispararAvanco(env, ctx);
    return json({ ok: true }, 202);
  }

  // Gatilho manual (útil sem esperar o cron). Gated pelo GoDeploy `authenticated`.
  if (metodo === 'POST' && pathname === '/api/processar') {
    dispararAvanco(env, ctx);
    return json({ ok: true, mensagem: 'Processamento disparado.' }, 202);
  }

  if (pathname.startsWith('/api/') || pathname.startsWith('/tasks/')) {
    return erro('Rota não encontrada.', 404);
  }

  // Não-API: a SPA estática (assets) responde. Se o Worker for invocado, redireciona
  // para a raiz (deep-link → SPA).
  return new Response(null, { status: 302, headers: { Location: '/' } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    configurarLog({ level: env.LOG_LEVEL, pretty: env.LOG_PRETTY === '1' || env.LOG_PRETTY === 'true' });
    const inicio = Date.now();
    const id = crypto.randomUUID().slice(0, 8);
    const caminho = new URL(req.url).pathname;
    try {
      const resp = await rotear(req, env, ctx);
      log.info('req', { id, m: req.method, path: caminho, status: resp.status, ms: Date.now() - inicio });
      return resp;
    } catch (e) {
      // Loga o erro real (sem PII): um throw em `rotear` (DB/segredo ausente) viraria
      // só um 500 opaco — e, num tick de cron, `CronError: internal error` sem mensagem.
      log.error('req erro', { id, m: req.method, path: caminho, ms: Date.now() - inicio, erro: stackErro(e) });
      return erro(msgErro(e) || 'Erro interno.', 500);
    }
  },
  // O cron do GoDeploy NÃO é um handler `scheduled`: a plataforma faz POST em
  // /tasks/processar (ver rota acima). Não adicionar `scheduled`/setInterval aqui.
};
