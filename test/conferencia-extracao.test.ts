import { describe, it, expect } from 'vitest';
import type { MensagemLlm, OpcoesLlm, ClienteLlm } from '../src/conferencia/contratos.js';
import type { CamposNfBrutos } from '../src/conferencia/tipos.js';
import type { LeitorPdf } from '../src/extract/ocr-worker.js';
import {
  criarClienteLlm,
  dropUnsupportedParam,
  criarExtratorCampos,
  parseCamposNf,
  PROMPT_SISTEMA_NF,
  sha256Hex,
  CacheExtracaoMemoria,
  criarExtracaoNf,
} from '../src/conferencia/extracao/index.js';

// ───────────────────────────── helpers ─────────────────────────────

interface ReqGravado {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

/** `fetch` fake que devolve respostas em sequência e grava cada request. */
function fetchFake(respostas: Response[]): { fetchImpl: typeof fetch; reqs: ReqGravado[] } {
  const reqs: ReqGravado[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === 'object' && !Array.isArray(h)) {
      for (const [k, v] of Object.entries(h as Record<string, string>)) headers[k] = String(v);
    }
    reqs.push({
      url: String(url),
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const r = respostas[i++];
    if (!r) throw new Error(`fetchFake: sem resposta para a chamada ${i}`);
    return r;
  }) as unknown as typeof fetch;
  return { fetchImpl, reqs };
}

const respostaOk = (conteudo: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), { status: 200 });

// ───────────────────────────── ClienteLlm ─────────────────────────────

describe('criarClienteLlm (AI Proxy)', () => {
  it('monta o request: endpoint, Bearer, model, messages e modo JSON', async () => {
    const { fetchImpl, reqs } = fetchFake([respostaOk('OK')]);
    const cliente = criarClienteLlm({
      baseUrl: 'https://proxy.test/v1/',
      apiKey: 'tok-123',
      model: 'modelo-happy',
      fetchImpl,
    });

    const out = await cliente.chat([{ role: 'user', content: 'oi' }], { jsonMode: true });

    expect(out).toBe('OK');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.url).toBe('https://proxy.test/v1/chat/completions');
    expect(reqs[0]!.headers['Authorization']).toBe('Bearer tok-123');
    const body = reqs[0]!.body!;
    expect(body.model).toBe('modelo-happy');
    expect(body.messages).toEqual([{ role: 'user', content: 'oi' }]);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_completion_tokens).toBe(2048);
  });

  it('usa OpenAI direto quando não há baseUrl', async () => {
    const { fetchImpl, reqs } = fetchFake([respostaOk('OK')]);
    const cliente = criarClienteLlm({ apiKey: 'k', model: 'modelo-direto', fetchImpl });
    await cliente.chat([{ role: 'user', content: 'x' }]);
    expect(reqs[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('remove parâmetro não suportado (400) e retenta sem ele — paridade gpt-5', async () => {
    const erro400 = new Response(
      JSON.stringify({
        error: { code: 'unsupported_value', param: 'temperature', message: 'Unsupported value: temperature' },
      }),
      { status: 400 },
    );
    const { fetchImpl, reqs } = fetchFake([erro400, respostaOk('DEPOIS')]);
    const cliente = criarClienteLlm({ apiKey: 'k', model: 'modelo-drop', fetchImpl });

    const out = await cliente.chat([{ role: 'user', content: 'x' }], { temperature: 0.5 });

    expect(out).toBe('DEPOIS');
    expect(reqs).toHaveLength(2);
    expect(reqs[0]!.body!.temperature).toBe(0.5);
    expect('temperature' in reqs[1]!.body!).toBe(false);
  });

  it('lança erro definitivo (401) sem retry', async () => {
    const { fetchImpl, reqs } = fetchFake([new Response('unauthorized', { status: 401 })]);
    const cliente = criarClienteLlm({ apiKey: 'k', model: 'modelo-401', fetchImpl, gatewayRetries: 2 });
    await expect(cliente.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/401/);
    expect(reqs).toHaveLength(1);
  });

  it('erro de gateway com gatewayRetries=0 falha rápido e não vaza HTML', async () => {
    const { fetchImpl } = fetchFake([new Response('<html>bad gateway</html>', { status: 502 })]);
    const cliente = criarClienteLlm({ apiKey: 'k', model: 'modelo-502', fetchImpl, gatewayRetries: 0 });
    await expect(cliente.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/gateway indisponível/);
  });

  it('lança quando falta credencial', async () => {
    const cliente = criarClienteLlm({ apiKey: '', model: 'm' });
    await expect(cliente.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/credencial/);
  });
});

describe('dropUnsupportedParam', () => {
  it('identifica e remove o parâmetro ofendido do body', () => {
    const body: Record<string, unknown> = { model: 'm', temperature: 1, max_tokens: 10 };
    const txt = JSON.stringify({ error: { code: 'unsupported_parameter', param: 'max_tokens', message: 'x' } });
    expect(dropUnsupportedParam(body, txt)).toBe('max_tokens');
    expect('max_tokens' in body).toBe(false);
  });

  it('devolve null (sem mexer no body) para erro não relacionado ou texto não-JSON', () => {
    const body: Record<string, unknown> = { temperature: 1 };
    expect(dropUnsupportedParam(body, JSON.stringify({ error: { code: 'rate_limit' } }))).toBeNull();
    expect(dropUnsupportedParam(body, 'isto não é json')).toBeNull();
    expect('temperature' in body).toBe(true);
  });
});

// ───────────────────────────── ExtratorCampos ─────────────────────────────

describe('parseCamposNf', () => {
  it('mapeia os 5 campos, ignora extras', () => {
    const c = parseCamposNf(
      '{"CNPJ1":"11.222.333/0001-81","Valor":100.5,"CNPJ2":"22.165.464/0001-90","data_emissao":"01/05/2026","num_nota":"123","lixo":"x"}',
    );
    expect(c).toEqual({
      CNPJ1: '11.222.333/0001-81',
      Valor: 100.5,
      CNPJ2: '22.165.464/0001-90',
      data_emissao: '01/05/2026',
      num_nota: '123',
    });
  });

  it('tolera cercas de código e texto ao redor', () => {
    expect(parseCamposNf('```json\n{"Valor":"100,00"}\n```')).toEqual({ Valor: '100,00' });
    expect(parseCamposNf('Claro! Aqui: {"num_nota": 42} fim')).toEqual({ num_nota: '42' });
  });

  it('campos ausentes/vazios não aparecem (vira NAO_LEGIVEL na C1)', () => {
    expect(parseCamposNf('{}')).toEqual({});
    expect(parseCamposNf('{"CNPJ1":"  ","num_nota":""}')).toEqual({});
  });

  it('lança em conteúdo não-JSON', () => {
    expect(() => parseCamposNf('desculpe, não consegui ler')).toThrow(/JSON/);
  });
});

describe('criarExtratorCampos', () => {
  it('usa o prompt §5.4, manda o texto como user e pede JSON + temperature 0', async () => {
    const chamadas: { mensagens: readonly MensagemLlm[]; opts: OpcoesLlm | undefined }[] = [];
    const cliente: ClienteLlm = {
      chat: (mensagens, opts) => {
        chamadas.push({ mensagens, opts });
        return Promise.resolve('{"CNPJ1":"x","Valor":10}');
      },
    };

    const campos = await criarExtratorCampos(cliente).extrair('TEXTO DA NOTA');

    expect(campos).toEqual({ CNPJ1: 'x', Valor: 10 });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.mensagens[0]).toEqual({ role: 'system', content: PROMPT_SISTEMA_NF });
    expect(chamadas[0]!.mensagens[1]).toEqual({ role: 'user', content: 'TEXTO DA NOTA' });
    expect(chamadas[0]!.opts).toMatchObject({ jsonMode: true, temperature: 0 });
  });

  it('PROMPT_SISTEMA_NF mantém paridade verbatim com o n8n (§5.4)', () => {
    expect(PROMPT_SISTEMA_NF).toContain('Você vai receber um texto que é uma Nota Fiscal. Extraia:');
    expect(PROMPT_SISTEMA_NF).toContain('Valor Líquido da nota (número float, ex: 100.00, sem R$)');
    expect(PROMPT_SISTEMA_NF).toContain('"CNPJ1": "CNPJ DO EMISSOR"');
    expect(PROMPT_SISTEMA_NF).toContain('"num_nota": "NÚMERO"');
  });
});

// ───────────────────────────── hash + cache ─────────────────────────────

describe('sha256Hex', () => {
  it('bate com vetor conhecido para string e bytes', async () => {
    const esperado = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256Hex('abc')).toBe(esperado);
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(esperado);
  });
});

describe('criarExtracaoNf (OCR → IA com cache por hash)', () => {
  it('faz OCR+IA na 1ª vez e serve do cache na 2ª (mesmo arquivo)', async () => {
    let ocr = 0;
    let ia = 0;
    const lerPdf: LeitorPdf = () => {
      ocr++;
      return Promise.resolve('texto-ocr');
    };
    const extrator = {
      extrair: (_texto: string): Promise<CamposNfBrutos> => {
        ia++;
        return Promise.resolve({ CNPJ1: '1', Valor: 5 });
      },
    };
    const extracao = criarExtracaoNf({ lerPdf, extrator });
    const bytes = new TextEncoder().encode('%PDF-fake');

    const a = await extracao.extrairDoPdf(bytes);
    const b = await extracao.extrairDoPdf(bytes);

    expect(a).toEqual({ CNPJ1: '1', Valor: 5 });
    expect(b).toEqual(a);
    expect(ocr).toBe(1);
    expect(ia).toBe(1);
  });

  it('hashConhecido evita rehashing e indexa o cache por ele', async () => {
    let ocr = 0;
    const lerPdf: LeitorPdf = () => {
      ocr++;
      return Promise.resolve('t');
    };
    const extrator = { extrair: (): Promise<CamposNfBrutos> => Promise.resolve({ num_nota: '9' }) };
    const cache = new CacheExtracaoMemoria();
    const extracao = criarExtracaoNf({ lerPdf, extrator, cache });

    await extracao.extrairDoPdf(new TextEncoder().encode('aaa'), 'hash-fixo');
    expect(await cache.obter('hash-fixo')).toEqual({ num_nota: '9' });

    // bytes diferentes, mas mesmo hashConhecido → cache hit, sem novo OCR
    await extracao.extrairDoPdf(new TextEncoder().encode('bbb'), 'hash-fixo');
    expect(ocr).toBe(1);
  });
});
