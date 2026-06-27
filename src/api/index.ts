/**
 * Barril da camada API/Worker (v2 · C6). O default export de `worker.ts` é o entrypoint
 * do GoDeploy; os demais são reaproveitáveis em testes/inspeção.
 */
export { default } from './worker.js';
export type { Env, GoDeployDB, ExecutionContext } from './env.js';
export {
  montarDepsConferencia,
  montarRepo,
  loteConferencia,
  type DepsConferencia,
} from './conferencia-deps.js';
export {
  avancarConfJobs,
  criarConferencia,
  confirmarMapeamento,
} from './conferencia-processar.js';
export { selarSessao, abrirSessao, lerCookie, cookieSessao, sessaoDoRequest } from './sessao.js';
