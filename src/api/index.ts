/**
 * Barril da camada API/Worker (F6). O default export de `worker.ts` é o entrypoint
 * do GoDeploy (`{ fetch, scheduled }`); os demais são reaproveitáveis em testes.
 */
export { default } from './worker.js';
export type { Env, GoDeployDB, ExecutionContext } from './env.js';
export { GoogleAuthRest, SheetsRest, ESCOPOS, type CredenciaisApp } from './google.js';
export { avancarJobs, novoJob, credenciaisApp, sheetsParaSessao } from './processar.js';
export { selarSessao, abrirSessao, lerCookie, cookieSessao, sessaoDoRequest } from './sessao.js';
export {
  initSchema,
  criarJob,
  obterJob,
  progressoJob,
  type RegistroSessao,
  type RegistroJob,
} from './db.js';
