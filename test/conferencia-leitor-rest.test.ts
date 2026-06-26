import { describe, it, expect } from 'vitest';
import { LeitorPlanilhaRest } from '../src/conferencia/pipeline/index.js';

interface Chamada {
  url: string;
  method: string;
  auth: string | undefined;
  body: unknown;
}

/** fetch fake que simula a Sheets REST e registra as chamadas. */
function fakeSheets() {
  const chamadas: Chamada[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = decodeURIComponent(String(url));
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      url: u,
      method,
      auth: headers['authorization'],
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const json = (obj: unknown) =>
      new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });

    if (u.includes('?fields=sheets.properties')) {
      return json({ sheets: [{ properties: { sheetId: 0, title: 'Resp' } }] });
    }
    if (method === 'GET' && u.includes('/values/')) {
      if (u.includes("!1:1")) return json({ values: [['Cupom', 'Link']] });
      return json({ values: [['Cupom', 'Link'], ['A', 'x'], ['', '']] });
    }
    return json({}); // PUT (garantirColunas) / POST (batchUpdate)
  }) as unknown as typeof fetch;

  return { fn, chamadas };
}

const ref = { spreadsheetId: 'S', aba: '0' }; // gid → resolve título

describe('LeitorPlanilhaRest', () => {
  it('resolve o título pelo gid e lê o cabeçalho com Bearer', async () => {
    const { fn, chamadas } = fakeSheets();
    const leitor = new LeitorPlanilhaRest(() => Promise.resolve('TOK'), { fetchImpl: fn });
    expect(await leitor.lerCabecalho(ref)).toEqual(['Cupom', 'Link']);
    expect(chamadas.some((c) => c.url.includes('sheets.properties'))).toBe(true);
    expect(chamadas.every((c) => c.auth === 'Bearer TOK')).toBe(true);
  });

  it('lê registros por cabeçalho e pula linhas vazias', async () => {
    const { fn } = fakeSheets();
    const leitor = new LeitorPlanilhaRest(() => Promise.resolve('TOK'), { fetchImpl: fn });
    const regs = await leitor.lerRegistros(ref);
    expect(regs).toHaveLength(1);
    expect(regs[0]).toEqual({ numeroLinha: 2, valores: { Cupom: 'A', Link: 'x' } });
  });

  it('garantirColunas cria só as que faltam (append no fim)', async () => {
    const { fn, chamadas } = fakeSheets();
    const leitor = new LeitorPlanilhaRest(() => Promise.resolve('TOK'), { fetchImpl: fn });
    await leitor.garantirColunas(ref, ['Cupom', 'Status (influ)']);
    const put = chamadas.find((c) => c.method === 'PUT');
    expect(put).toBeDefined();
    expect((put?.body as { values: string[][] }).values).toEqual([['Status (influ)']]);
    expect(put?.url).toContain('valueInputOption=RAW');
    expect(put?.url).toContain("'Resp'!C1"); // 3ª coluna (após Cupom, Link)
  });

  it('escreve em lote (USER_ENTERED) mapeando coluna→A1', async () => {
    const { fn, chamadas } = fakeSheets();
    const leitor = new LeitorPlanilhaRest(() => Promise.resolve('TOK'), { fetchImpl: fn });
    await leitor.escrever(ref, [{ numeroLinha: 2, coluna: 'Link', valor: 'z' }]);
    const post = chamadas.find((c) => c.method === 'POST');
    expect(post?.url).toContain('values:batchUpdate');
    const body = post?.body as { valueInputOption: string; data: { range: string; values: string[][] }[] };
    expect(body.valueInputOption).toBe('USER_ENTERED');
    expect(body.data[0]?.range).toBe("'Resp'!B2");
    expect(body.data[0]?.values).toEqual([['z']]);
  });
});
