import { describe, it, expect } from 'vitest';
import { decidirStatusJob } from '../src/conferencia/persistencia/jobs-db.js';
import type { ResumoPerfil, ResultadoFrente } from '../src/conferencia/pipeline/index.js';
import type { ResultadoConferencia } from '../src/conferencia/index.js';

function res(cupom: string): ResultadoConferencia {
  return {
    cupom,
    cupomOriginal: cupom,
    status: 'APROVADO',
    valorEsperadoCentavos: 100,
    retroativoCentavos: 0,
    valorTotalCentavos: 100,
  };
}

function frente(over: Partial<ResultadoFrente> & Pick<ResultadoFrente, 'frente'>): ResultadoFrente {
  return { resultados: [], precisaConfirmarMapeamento: false, ...over };
}

function resumo(frentes: ResultadoFrente[]): ResumoPerfil {
  return { perfilId: 'p', mesAlvo: '05/2026', frentes };
}

describe('decidirStatusJob', () => {
  it('pausa quando alguma frente pede confirmação de mapeamento', () => {
    const r = resumo([
      frente({ frente: 'INFLUS', precisaConfirmarMapeamento: true }),
      frente({ frente: 'ASSESSORIA', resultados: [res('A')] }),
    ]);
    expect(decidirStatusJob(r)).toEqual({
      status: 'AGUARDANDO_MAPEAMENTO',
      frenteParaConfirmar: 'INFLUS',
    });
  });

  it('conclui quando nenhuma frente de extração processou cupom', () => {
    const r = resumo([
      frente({ frente: 'INFLUS' }),
      frente({ frente: 'ASSESSORIA' }),
      frente({ frente: 'SOMA' }),
    ]);
    expect(decidirStatusJob(r).status).toBe('CONCLUIDO');
  });

  it('continua processando enquanto houver cupons em alguma frente de extração', () => {
    const r = resumo([
      frente({ frente: 'INFLUS', resultados: [res('A'), res('B')] }),
      frente({ frente: 'ASSESSORIA' }),
    ]);
    expect(decidirStatusJob(r).status).toBe('PROCESSANDO');
  });

  it('SOMA sozinha não impede a conclusão (não é frente de extração)', () => {
    const r = resumo([
      frente({ frente: 'INFLUS' }),
      frente({ frente: 'ASSESSORIA' }),
      frente({ frente: 'SOMA', resultados: [res('A')] }),
    ]);
    expect(decidirStatusJob(r).status).toBe('CONCLUIDO');
  });
});
