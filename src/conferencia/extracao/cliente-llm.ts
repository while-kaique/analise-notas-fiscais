/**
 * Cliente do **GoGroup AI Proxy** (gateway OpenAI-compatível) — implementação do
 * contrato `ClienteLlm` (C0). **Porte** de `godocs-main/src/lib/llm.ts` para ser
 * **Workers-friendly**: só `fetch`/`crypto` globais, **config injetada** (nada de
 * `process.env` no módulo) e `fetch` substituível para testes.
 *
 * Usado por `ExtratorCampos` (C3) e `MapeadorColunas` (C2).
 *
 * Contrato HTTP (spec §2): `POST {baseUrl}/chat/completions`, header
 * `Authorization: Bearer {apiKey}`, body `{ model, messages, temperature?,
 * max_completion_tokens?, response_format? }`. Modelos novos (gpt-5) usam
 * `max_completion_tokens` e **rejeitam** `temperature` → `dropUnsupportedParam`
 * remove o parâmetro ofendido e retenta na hora (sem custo de gateway-retry).
 *
 * Segredos (CLAUDE.md §6): `apiKey`/`baseUrl` vêm de fora (env / GoDeploy secret),
 * nunca do código. **Nunca logamos o conteúdo das mensagens** — o texto da NF é
 * dado fiscal/PII (CLAUDE.md §6).
 *
 * Diferença consciente vs. o godocs: **não** portamos o "fallback para OpenAI direto
 * com chave dedicada" (resiliência específica daquele projeto). O endpoint é único;
 * erros transitórios de gateway/rede/timeout são cobertos por `gatewayRetries`.
 */
import type { ClienteLlm, MensagemLlm, OpcoesLlm } from '../contratos.js';

export interface ConfigLlm {
  /**
   * Base URL do AI Proxy (`LLM_BASE_URL`), ex.: `https://proxy.exemplo/v1`. Com ela,
   * `apiKey` é o `API_PROXY_TOKEN`. Sem ela, cai na API direta (`apiKey` = `LLM_API_KEY`).
   */
  baseUrl?: string;
  /** Token do proxy (`API_PROXY_TOKEN`) ou chave direta (`LLM_API_KEY`). */
  apiKey: string;
  /** Modelo default (`LLM_MODEL`). Sobrescrevível por chamada (`OpcoesLlm.model`). */
  model: string;
  /** Gateway de destino (`LLM_PROVIDER`). Default `'openai'` (compatível com o proxy). */
  provider?: 'openai' | 'anthropic';
  /** Timeout por tentativa, em ms (aborta o `fetch`). Default 25000. */
  timeoutMs?: number;
  /** Retries em erro transitório de gateway/rede/timeout (backoff 2s). Default 2. */
  gatewayRetries?: number;
  /** `fetch` injetável (testes). Default: `fetch` global. */
  fetchImpl?: typeof fetch;
}

const TIMEOUT_PADRAO_MS = 25_000;
const GATEWAY_RETRIES_PADRAO = 2;
const TEMPERATURE_PADRAO = 0.7;
const MAX_TOKENS_PADRAO = 2048;
const BACKOFF_MS = 2000;
const BASE_OPENAI = 'https://api.openai.com/v1';
const BASE_ANTHROPIC = 'https://api.anthropic.com/v1';

/**
 * Parâmetros que cada modelo já provou rejeitar (ex.: gpt-5 não aceita `temperature`).
 * Aprendido na 1ª chamada para não pagar um 400 em toda chamada seguinte. Escopo de
 * módulo de propósito (cache compartilhado entre instâncias do cliente).
 */
const naoSuportadoPorModelo = new Map<string, Set<string>>();

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Cria um `ClienteLlm` que conversa com o AI Proxy (ou API direta) via `fetch`. */
export function criarClienteLlm(config: ConfigLlm): ClienteLlm {
  const fetchImpl = config.fetchImpl ?? fetch;
  const provider = config.provider ?? 'openai';
  const timeoutMs = config.timeoutMs ?? TIMEOUT_PADRAO_MS;
  const gatewayRetries = config.gatewayRetries ?? GATEWAY_RETRIES_PADRAO;

  return {
    async chat(mensagens: readonly MensagemLlm[], opts?: OpcoesLlm): Promise<string> {
      if (!config.apiKey) {
        throw new Error(
          config.baseUrl
            ? 'AI Proxy sem credencial: defina API_PROXY_TOKEN (modo proxy via LLM_BASE_URL).'
            : 'LLM sem credencial: defina LLM_API_KEY (ou LLM_BASE_URL + API_PROXY_TOKEN).',
        );
      }
      const model = opts?.model ?? config.model;
      if (!model) throw new Error('LLM sem modelo: defina LLM_MODEL ou OpcoesLlm.model.');

      if (provider === 'anthropic') {
        return chamarAnthropic(fetchImpl, mensagens, {
          model,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          temperature: opts?.temperature,
          maxTokens: opts?.maxTokens,
          timeoutMs,
        });
      }
      return chamarOpenAi(fetchImpl, mensagens, {
        model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        temperature: opts?.temperature,
        maxTokens: opts?.maxTokens,
        jsonMode: opts?.jsonMode,
        timeoutMs,
        gatewayRetries,
      });
    },
  };
}

interface OpcoesOpenAi {
  model: string;
  apiKey: string;
  baseUrl: string | undefined;
  temperature: number | undefined;
  maxTokens: number | undefined;
  jsonMode: boolean | undefined;
  timeoutMs: number;
  gatewayRetries: number;
}

const ehErroGateway = (status: number): boolean =>
  status === 502 || status === 503 || status === 520 || status === 522 || status === 524;

async function chamarOpenAi(
  fetchImpl: typeof fetch,
  mensagens: readonly MensagemLlm[],
  opts: OpcoesOpenAi,
): Promise<string> {
  // Endpoint: proxy (`baseUrl`) ou OpenAI direto. Aceita base com ou sem barra final.
  const endpoint = `${(opts.baseUrl ?? BASE_OPENAI).replace(/\/+$/, '')}/chat/completions`;

  // Modelos novos (gpt-5+) usam `max_completion_tokens` em vez de `max_tokens`.
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: mensagens.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? TEMPERATURE_PADRAO,
    max_completion_tokens: opts.maxTokens ?? MAX_TOKENS_PADRAO,
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  // Remove de cara o que já sabemos que este modelo rejeita.
  const conhecidos = naoSuportadoPorModelo.get(opts.model);
  if (conhecidos) for (const p of conhecidos) delete body[p];

  let retriesRestantes = opts.gatewayRetries;
  let ultimoErro: Error | null = null;

  while (true) {
    let res: Response;
    try {
      const controle = new AbortController();
      const timer = setTimeout(() => controle.abort(), opts.timeoutMs);
      try {
        res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controle.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (erroRede) {
      // Rede caiu/reset/DNS, ou o proxy demorou e abortamos (AbortError). Transitório.
      const abortado = erroRede instanceof Error && erroRede.name === 'AbortError';
      ultimoErro = abortado
        ? new Error(`AI Proxy excedeu o timeout de ${opts.timeoutMs}ms (não respondeu).`)
        : erroRede instanceof Error
          ? erroRede
          : new Error(String(erroRede));
      if (retriesRestantes <= 0) throw ultimoErro;
      retriesRestantes--;
      await esperar(BACKOFF_MS);
      continue;
    }

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const conteudo = data.choices?.[0]?.message?.content;
      if (conteudo == null) {
        throw new Error('AI Proxy respondeu sem conteúdo (choices/message vazio).');
      }
      return conteudo;
    }

    const textoErro = await res.text().catch(() => '');

    // 400 por parâmetro não suportado: remove, memoriza e retenta NA HORA (não é
    // erro de gateway — não consome retry nem faz backoff).
    const removido = res.status === 400 ? dropUnsupportedParam(body, textoErro) : null;
    if (removido) {
      const set = naoSuportadoPorModelo.get(opts.model) ?? new Set<string>();
      set.add(removido);
      naoSuportadoPorModelo.set(opts.model, set);
      continue;
    }

    // Não expõe HTML de página de erro de gateway (Cloudflare 5xx).
    const resumo = textoErro.trimStart().startsWith('<')
      ? `gateway indisponível (HTTP ${res.status}) — tente novamente em instantes`
      : textoErro.slice(0, 300);
    ultimoErro = new Error(`AI Proxy erro ${res.status}: ${resumo}`);

    if (!ehErroGateway(res.status)) throw ultimoErro; // definitivo (auth, 4xx, etc.)
    if (retriesRestantes <= 0) throw ultimoErro;
    retriesRestantes--;
    await esperar(BACKOFF_MS);
  }
}

/**
 * Se o erro 400 indicar parâmetro/valor não suportado pelo modelo, remove o parâmetro
 * do `body` (caindo no default do modelo) e devolve seu nome para retry. Cobre:
 *  - `unsupported_parameter` (ex.: `max_tokens` não aceito por gpt-5+);
 *  - `unsupported_value` (ex.: `temperature` só aceita o default em alguns modelos).
 * Função **pura** sobre `errText` (testável isoladamente).
 */
export function dropUnsupportedParam(
  body: Record<string, unknown>,
  textoErro: string,
): string | null {
  let parsed: { error?: { code?: string; param?: string; message?: string } };
  try {
    parsed = JSON.parse(textoErro) as typeof parsed;
  } catch {
    return null;
  }
  const err = parsed.error;
  if (!err) return null;
  const msg = err.message ?? '';
  const ehNaoSuportado =
    err.code === 'unsupported_parameter' ||
    err.code === 'unsupported_value' ||
    /unsupported (parameter|value)/i.test(msg) ||
    /only the default .* (value )?is supported/i.test(msg);
  const param = err.param;
  if (!ehNaoSuportado || !param || !(param in body)) return null;
  delete body[param];
  return param;
}

interface OpcoesAnthropic {
  model: string;
  apiKey: string;
  baseUrl: string | undefined;
  temperature: number | undefined;
  maxTokens: number | undefined;
  timeoutMs: number;
}

async function chamarAnthropic(
  fetchImpl: typeof fetch,
  mensagens: readonly MensagemLlm[],
  opts: OpcoesAnthropic,
): Promise<string> {
  const endpoint = `${(opts.baseUrl ?? BASE_ANTHROPIC).replace(/\/+$/, '')}/messages`;
  const system = mensagens.find((m) => m.role === 'system')?.content;
  const conversa = mensagens
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: conversa,
    max_tokens: opts.maxTokens ?? MAX_TOKENS_PADRAO,
    temperature: opts.temperature ?? TEMPERATURE_PADRAO,
  };
  if (system) body.system = system;

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controle.signal,
    });
  } catch (erro) {
    if (erro instanceof Error && erro.name === 'AbortError') {
      throw new Error(`AI Proxy (Anthropic) excedeu o timeout de ${opts.timeoutMs}ms.`);
    }
    throw erro;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI Proxy (Anthropic) erro ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: { text?: string }[] };
  const texto = data.content?.[0]?.text;
  if (texto == null) throw new Error('AI Proxy (Anthropic) respondeu sem conteúdo.');
  return texto;
}
