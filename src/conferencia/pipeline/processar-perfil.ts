/**
 * Orquestra um **perfil** inteiro (spec §3): roda as frentes na ordem configurada
 * (Influencers = INFLUS → ASSESSORIA → SOMA; Embaixadores = EMBAIXADOR). A SOMA usa
 * as colunas de saída de INFLUS/ASSESSORIA do próprio perfil. O link do formulário do
 * mês vem de `perfil.formSheetUrl` (decisão 4).
 */
import type { Marca, Perfil, PlanilhaRef } from '../tipos.js';
import { extrairSpreadsheetId } from '../../sheets/spreadsheet-id.js';
import { processarFrente } from './processar-frente.js';
import { processarSoma } from './processar-soma.js';
import type { DepsPipeline, OpcoesProcessamento, ResultadoFrente, ResumoPerfil } from './tipos.js';

/** Deriva a `PlanilhaRef` do formulário a partir do link colado (id + gid). */
export function refDoFormUrl(url: string | undefined): PlanilhaRef | null {
  if (!url) return null;
  const spreadsheetId = extrairSpreadsheetId(url);
  if (!spreadsheetId) return null;
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1];
  return { spreadsheetId, aba: gid ?? '' };
}

export async function processarPerfil(
  perfil: Perfil,
  marca: Marca,
  mesAlvo: string,
  deps: DepsPipeline,
  opts: OpcoesProcessamento = {},
): Promise<ResumoPerfil> {
  const formRef = refDoFormUrl(perfil.formSheetUrl);
  if (!formRef) {
    throw new Error(`Perfil "${perfil.id}" sem link de formulário válido (formSheetUrl).`);
  }
  const baseRef = perfil.base;

  const influ = perfil.frentes.find((f) => f.tipo === 'INFLUS')?.colunasSaida;
  const assessoria = perfil.frentes.find((f) => f.tipo === 'ASSESSORIA')?.colunasSaida;

  const frentes: ResultadoFrente[] = [];
  for (const frente of perfil.frentes) {
    if (frente.tipo === 'SOMA') {
      if (influ && assessoria) {
        frentes.push(
          await processarSoma(
            { perfilId: perfil.id, baseRef, formRef, influ, assessoria, marca, mesAlvo },
            deps,
            opts,
          ),
        );
      }
      continue;
    }
    frentes.push(
      await processarFrente({ perfilId: perfil.id, baseRef, formRef, frente, marca, mesAlvo }, deps, opts),
    );
  }

  return { perfilId: perfil.id, mesAlvo, frentes };
}
