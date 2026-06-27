# CLAUDE.md — Plataforma de Análise de Notas Fiscais

Instruções para desenvolvimento neste repositório. Leia antes de codar.

## 0. Documentação — três camadas

A documentação do projeto vive em três níveis, com papéis distintos:

| Camada | Onde | Papel |
|--------|------|-------|
| **Spec** | `spec-docs/` | **Planejamento/handoff:** o que vai ser feito, decisões fechadas, status e o mapa de onde cada coisa aterrissou. Bússola entre sessões/PRs. |
| **Doc técnica** | `docs/` (quando existir) | Como o sistema funciona **hoje** (estado consolidado). |
| **CLAUDE.md** | raiz | Regras operacionais + resumo vivo. |

- O spec ativo é **[`spec-docs/SPEC_FATIAS_V1.md`](spec-docs/SPEC_FATIAS_V1.md)** (fatias F0–F6,
  decisões fechadas, runbook). É **versionado** e **atualizado por decisão**, não por prompt:
  ao mudar uma decisão ou uma fatia trocar de status, atualize-o **no mesmo PR**.
- Há uma **memória persistente pareada** (`fatias-v1-spec-junho-2026`) que serve de gancho
  entre sessões — o runbook do spec manda ler o spec + a memória ao retomar.
- Ciclo de vida: quando o v1 fechar, o spec pode ser removido ou virar doc em `docs/`.

## 1. O que é o projeto

Plataforma web que recebe o **link de uma planilha do Google Sheets**, lê os registros,
**baixa as notas fiscais em PDF**, aplica **OCR** para extrair os dados e **grava o
resultado de volta na própria planilha**, linha por linha.

O domínio é **nota fiscal brasileira** (NF-e / NFS-e / NFC-e). Sempre que possível,
prefira a fonte de dados mais estruturada disponível antes de cair no OCR:

1. **XML da NF-e** (mais confiável — é o documento fiscal oficial).
2. **Texto embutido no PDF** (`pdf-parse` / camada de texto), quando o PDF não é escaneado.
3. **OCR** (último recurso, para PDFs que são imagem escaneada).

## 2. Stack e decisões base

- **Linguagem:** TypeScript (Node.js LTS). `strict: true` no `tsconfig`. Sem `any` solto —
  use `unknown` + narrowing quando o tipo for incerto.
- **Integração de planilha:** Google Sheets API (`googleapis`). **OAuth do usuário** é o
  caminho escolhido (ver Decisões): o usuário faz login com Google e autoriza o app a
  ler/escrever suas planilhas. Guarde refresh tokens com segurança e nunca os commite.
- **OCR:** comece com Tesseract (`tesseract.js` ou binário via wrapper), com idioma `por`.
  Mantenha o OCR atrás de uma interface (`OcrProvider`) para trocar por Cloud Vision /
  Textract sem reescrever o pipeline.
- **Processamento:** assíncrono e por job. Uma planilha pode ter centenas de linhas;
  nunca processe tudo numa request HTTP síncrona — use fila/worker.

> Estas escolhas são o ponto de partida. Mudanças de stack devem ser discutidas e
> registradas aqui (seção "Decisões") antes de implementar.

## 3. Princípios de arquitetura

- **Separe as camadas:** `sheets/` (I/O da planilha), `download/` (obter PDFs),
  `ocr/` (extração), `parsing/` (PDF/imagem → campos da nota), `pipeline/` (orquestração),
  `api/` (HTTP), `web/` (frontend). Cada uma esconde sua dependência externa atrás de uma
  interface.
- **Idempotência por linha:** reprocessar a mesma planilha não pode duplicar nem corromper
  resultados. Use a coluna de status para pular o que já foi concluído.
- **Falha isolada:** o erro em uma linha (PDF quebrado, link morto, OCR ilegível) **não**
  pode derrubar o lote. Registre o erro naquela linha e siga.
- **Tudo rastreável:** cada linha processada recebe status + timestamp + (se erro) motivo.

## 4. Contrato com a planilha

A planilha é a interface principal com o usuário — trate-a como API pública.

- **Nunca destrua dados do usuário.** Escreva os resultados em colunas próprias
  (ex.: `Status`, `Valor`, `CNPJ Emitente`, `Data Emissão`, `Erro`, `Processado em`).
  Identifique colunas pelo **cabeçalho**, não por índice fixo — o usuário pode reordenar.
- **Status por linha** com um vocabulário fixo: `PENDENTE` → `PROCESSANDO` → `CONCLUIDO` /
  `ERRO`. Escreva `PROCESSANDO` antes de começar a linha (evita corrida em reprocessos).
- **Escrita em lote** (`batchUpdate`), não célula a célula — respeita os limites de quota
  da API do Sheets e é muito mais rápido.
- Se uma coluna esperada não existir, **crie-a** (ou avise claramente), não assuma posição.

## 5. Pipeline de OCR — cuidados

- **Pré-processe a imagem** antes do OCR (deskew, binarização, aumento de DPI). A qualidade
  do OCR depende mais do pré-processamento do que do motor.
- **Não confie cegamente no número extraído.** Valide: CNPJ com dígito verificador, datas
  plausíveis, valores numéricos coerentes (`R$` → número). Marque baixa confiança em vez de
  gravar lixo.
- **Normalize a saída:** valores como `number` (centavos ou decimal consistente), datas em
  ISO 8601, CNPJ/CPF só dígitos. A formatação para exibição é responsabilidade do frontend.
- **Cacheie o download e o OCR** por hash do arquivo — não rebaixe nem reprocesse o mesmo
  PDF à toa.

## 6. Segurança e segredos

- **Nunca** commite `.env`, `service-account.json`, `credentials.json`, tokens ou `.pem`.
  Já estão no `.gitignore` — mantenha assim.
- Links de planilha e de PDF vêm de fora: **valide e trate como não confiáveis**.
  Cuidado com SSRF no download de PDFs (bloqueie IPs internos/localhost; só http/https;
  limite tamanho e timeout).
- Não logue conteúdo de nota fiscal (dados fiscais/PII) em texto puro nos logs.
- Aplique limites: tamanho máximo de PDF, timeout de HTTP, concorrência máxima de downloads.

## 7. Convenções de código

- **Commits** em Português, no imperativo: `adiciona leitura da planilha`,
  `corrige parsing de CNPJ`. Pequenos e focados.
- **Não commite na `main` direto** sem pedido explícito; trabalhe em branch
  (`feat/...`, `fix/...`) e abra PR.
- **SEMPRE use git worktree para alterações de código.** Este repositório é tocado por
  múltiplos chats do Claude em paralelo, cada um construindo uma feature diferente. Para
  evitar que um chat sobrescreva o trabalho do outro, **toda mudança de código deve
  acontecer em um worktree isolado** (uma pasta separada com sua própria branch), nunca no
  diretório principal compartilhado.
- **Todos os worktrees ficam DENTRO de uma única pasta-contêiner irmã do projeto:**
  `../analise-notas-fiscais-worktrees/`. Assim o diretório pai não fica poluído com várias
  pastas soltas — fica só `analise-notas-fiscais/` (principal) e
  `analise-notas-fiscais-worktrees/` (com um subdiretório por feature). **Nunca** crie o
  worktree dentro do próprio repositório (ele acabaria versionado) nem solto ao lado dele.
- Fluxo (rodar pela ferramenta **Bash**/Git Bash):
  - Garanta a pasta-contêiner uma vez: `mkdir -p ../analise-notas-fiscais-worktrees`.
  - Crie o worktree a partir da `main` atualizada, com branch dedicada:
    `git worktree add ../analise-notas-fiscais-worktrees/<feature> -b feat/<feature> main`
  - Trabalhe, commite e abra o PR **de dentro** desse worktree.
  - **DEFINIÇÃO DE PRONTO — atualizar o status da fatia no spec faz parte de terminar.**
    Antes de pedir o merge, o **mesmo PR** DEVE marcar a fatia na tabela do roadmap
    (`spec-docs/SPEC_CONFERENCIA_V2.md` §9, status global no topo e "onde aterrissou") como
    `✅ PR #N mergeada` (ou o estado atual) — **não** deixe `em andamento`/`⬜` numa fatia
    concluída. _(Erro real: a **C1** foi finalizada e mergeada sem atualizar o spec, que ficou
    "🟦 em andamento"; outro chat teve de corrigir depois. Não repita: a fatia só está
    "pronta" quando o spec reflete isso.)_
  - Ao terminar (PR mergeado), remova:
    `git worktree remove ../analise-notas-fiscais-worktrees/<feature>` e
    `git branch -d feat/<feature>`. Use `git worktree prune` se sobrar referência.
  - Liste o que está ativo com `git worktree list`.
  - **Não** edite arquivos no diretório principal para uma feature; ele fica só para
    inspeção/coordenação. Exceções pontuais (ex.: editar este `CLAUDE.md`) devem ser
    combinadas explicitamente.
- **Testes** para parsing/validação (a parte com mais regras e casos de borda). Use
  fixtures de notas reais anonimizadas em `test/fixtures/` — **sem dados reais sensíveis**.
- **Erros** com mensagens acionáveis (o que falhou + qual linha/arquivo). Sem `catch` vazio.
- Funções puras na lógica de parsing/validação; deixe I/O (rede, disco, Sheets) nas bordas.

## 8. Ambiente local (Windows)

- Para comandos **git/gh use a ferramenta Bash** (Git Bash); no PowerShell o git não está
  no PATH. `gh` já está autenticado.
- Use a pasta de scratch para arquivos temporários de teste — não suje o repo com PDFs.

## 9. Workflow com o Claude

- **Planeje antes de implementar** mudanças não triviais; confirme a abordagem.
- Ao adicionar dependência externa nova (OCR engine, lib de PDF, provider de fila),
  **registre o porquê** na seção de Decisões abaixo.
- Mantenha este arquivo vivo: ao mudar uma convenção ou decisão de arquitetura,
  atualize aqui no mesmo PR.
- **Mantenha o spec vivo (§0):** ao avançar uma fatia (status, PR, "onde aterrissou") ou
  fechar/alterar uma decisão, atualize `spec-docs/SPEC_FATIAS_V1.md` **no mesmo PR**. Ao
  retomar numa nova sessão, leia o spec + a memória `fatias-v1-spec-junho-2026` (runbook lá).

## 10. Roadmap de fatias (desenvolvimento paralelo)

> Visão rápida. O **detalhe vivo** (escopo, "onde aterrissou", decisões, runbook) está em
> **[`spec-docs/SPEC_FATIAS_V1.md`](spec-docs/SPEC_FATIAS_V1.md)** — mantenha os dois em sincronia.

O projeto é dividido em **fatias independentes**, cada uma construída por um chat do Claude
em seu próprio worktree (ver §7). A F0 define os **contratos** (tipos + interfaces em `src/`);
as demais implementam contra esses contratos e podem rodar em paralelo. Ao concluir uma
fatia, marque-a aqui (PR + estado).

| Fatia | Escopo | Depende de | Estado |
| ----- | ------ | ---------- | ------ |
| **F0 — Fundação** | `tsconfig` strict, tipos compartilhados, interfaces de todas as camadas, `loadConfig` | — | ✅ PR #1 mergeada |
| **F1 — Parsing/validação** | funções puras: CNPJ/CPF (DV), `ValorParaCentavos`, `NormalizarData`, normalização. Muitos testes. | F0 | ✅ PR #3 mergeada |
| **F2 — Extract** | `NotaExtractor` cascata XML → **Cloudflare OCR Worker** (PDF→texto+OCR) | F0, F1 | ✅ PR #8 mergeada (+ revisão p/ worker) |
| **F3 — Auth + Sheets** | `GoogleAuthProvider` (OAuth), `SheetsClient` (ler/escrever em lote por cabeçalho) | F0 | ✅ PR #5 mergeada |
| **F4 — Download** | `FileFetcher` com SSRF guard, limites, cache por hash | F0 | ✅ PR #6 mergeada |
| **F5 — Pipeline + Queue** | `ProcessarLinha`/`ProcessarJob` (idempotência, falha isolada), `JobQueue` | F0 (F2/F3/F4 via interface) | ✅ PR #4 mergeada |
| **F6 — API + Web** | Worker GoDeploy (SPA + rotas) + processamento por cron sobre `env.DB` | F0, F5 | ✅ PR #10 mergeada |
| **FUND — Migração GoDeploy/Workers** | reestruturar runtime p/ Cloudflare Workers (fila→`env.DB`+cron, SDKs Node→`fetch`/REST, OCR→HTTP) | F3, F4, F5 | 🟦 em andamento (iniciada na F6) |

**Ordem sugerida:** mergear F0 → atacar **F1** e **F3/F4** em paralelo (não dependem entre
si) → F2 (após F1) → F5 (após F2/F3/F4) → F6 (fecha). Frameworks ainda **a confirmar** por
fatia: fila (no v1 = `env.DB`+cron do GoDeploy, atrás do contrato `JobQueue`), testes (Vitest,
já no F0). Registre a escolha em §11 ao implementar.

> **Plataforma alvo (decisão 2026-06-25, ver §11): GoDeploy / Cloudflare Workers**, app SPA.
> Runtime **stateless e sem processo em background** — daí a fila virar `env.DB`+cron e os SDKs
> Node (`googleapis`, `pdf-parse`, `node:dns`) precisarem migrar para `fetch`/REST (task **FUND**).

> **➡️ v1 FECHADO (F0–F6 mergeadas). Trabalho ativo = v2 — Conferência de NF por Cupom.**
> Migração dos 4 fluxos n8n (`fluxos_n8n/`): validar NFs por **cupom** cruzando FORMULÁRIO × BASE,
> por marca, com retroativo e soma. **Substitui** o fluxo genérico do v1 (reusa a infra). Spec ativo:
> **[`spec-docs/SPEC_CONFERENCIA_V2.md`](spec-docs/SPEC_CONFERENCIA_V2.md)** (fatias **C0–C6**:
> C0–C5 mergeadas, **C6 — API/Web + flip + remoção do v1 — feita** em `feat/conferencia-api-web`, em PR).
> v2 completo no código; falta só provisionar runtime (secrets da `rpa_ia` + cron no GoDeploy).
> Memória: `conferencia-v2-spec-junho-2026`.

## 11. Decisões (log)

> Registre aqui decisões de arquitetura/stack com data e motivo. Ex.:
- **2026-06-27 (Colunas de saída com prefixo `bot_`)** — as colunas que o bot cria/escreve no
  formulário passam a ter o prefixo `bot_` (`colunasSaidaPadrao` em `src/conferencia/perfis/seed.ts`).
  Motivo: o formulário Google já tem colunas nativas como `Status`/`Observações`/`N° do chamado`; sem
  prefixo o bot escrevia por cima do `Status` do usuário (viola §4) **e** a idempotência (`merge.ts`)
  lia esse `Status` já preenchido → pulava todas as linhas (`aProcessar=0`). Com `bot_*`, o
  `garantirColunas` cria colunas próprias e a idempotência lê a do bot. Também: default de `LLM_MODEL`
  no `.env.example` corrigido para `gpt-5.4-mini` (o AI Proxy GoGroup só serve gpt-5.x; modelo
  inexistente retorna 502, não 400/404).
- **2026-06-27 (Observabilidade + dev local)** — sistema de logs e servidor local, **sem dep nova**:
  - **Logs estruturados** em `src/obs/log.ts` (Workers-safe: só `console`/`Date`/`JSON`). Níveis
    debug/info/warn/error via `LOG_LEVEL`; `LOG_PRETTY=1` formata p/ humano (dev). `log.filho({...})`
    para contexto (job/frente/request). **Regra §6:** nunca logar conteúdo fiscal (valor/CNPJ/nº/texto
    do OCR) — só identificadores (cupom, fileId, hash, status, contagens, durações) e nomes de coluna.
  - **Instrumentação por wrapper** (`src/obs/instrumentar-deps.ts`): `instrumentarDeps(deps, log)`
    envolve as bordas de I/O (Sheets/Drive/OCR+IA/mapeador) com logs de duração/erro **sem tocar nas
    implementações**; aplicado em `montarDepsConferencia`. Orquestração (job/frente/cupom) loga em
    `conferencia-processar.ts` e `pipeline/processar-frente.ts`. `worker.ts` loga cada request (id+ms).
  - **Servidor local** (`src/local/`): roda o MESMO worker em Node — `env.DB` sobre **`node:sqlite`**
    (built-in, Node ≥22; tipos declarados localmente em `node-sqlite.d.ts`), segredos via
    `node --env-file=.env`, assets da SPA com fallback, e um "cron" local (`setInterval`) chamando
    `avancarConfJobs`. **`npm run dev`** (build + sobe em `:8787`). Não vai pro deploy (o bundle parte
    de `dist/api/worker.js`, que não importa `src/local/` nem `node:*`). DB local em `.dev/` (gitignored).
    _Atenção:_ OCR/AI Proxy precisam de `OCR_WORKER_*`/`LLM_BASE_URL`/`API_PROXY_TOKEN` no `.env` (só
    no GoDeploy hoje) — sem eles o processamento local falha no passo de extração (Drive/Sheets funcionam).
- **2026-06-26 (C6 — API/Web + flip + remoção do v1)** — fecha o v2 no código. Decisões da fatia:
  - **Worker stateless + cron** (CLAUDE.md §2/decisão GoDeploy): `worker.ts` roteia `/api/*` e
    `/tasks/processar` sem framework. `POST /api/conferencias` **persiste** o job (`conf_jobs` em
    `env.DB`) e dispara um avanço imediato (`ctx.waitUntil`); o **cron** (`POST /tasks/processar`,
    header assinado `X-Godeploy-Cron` validado contra `GODEPLOY_CRON_KEY`) avança **1 lote por tick**
    de cada job ativo (`CONF_BATCH_SIZE`, default 25). **Sem `scheduled`/`setInterval`** (modelo do
    GoDeploy é POST numa rota). `decidirStatusJob` é **puro** (testado): pausa em
    `AGUARDANDO_MAPEAMENTO`, conclui quando nenhuma frente de extração processa cupom (parada pela
    idempotência da C5 na planilha), senão continua.
  - **Sem login Google na UI** (decisão 11): acesso gated pelo GoDeploy `authenticated`; a identidade
    que toca Drive/Sheets é a `rpa_ia` (refresh token). SPA vanilla (`src/web/`): perfil → mês + link
    do form → dashboard com poll; tela de confirmação de mapa só quando a IA fica incerta.
  - **Flip + remoção do v1 genérico** (strangler-fig, spec §1): removidos `src/{auth,pipeline,queue}/`,
    `src/api/{db,deps,google,processar}.ts`, `src/extract/{index,montar,nota-extractor,texto,xml}.ts`,
    `src/index.ts`, `src/types/{google,job,linha,nota}.ts` e os testes do v1. Mantidos/reusados:
    `src/sheets/{colunas,spreadsheet-id}.ts` (puros), `src/download/file-fetcher-workers.ts` (fallback),
    parsing F1 e `src/conferencia/*`. **Nenhuma dependência externa nova.** Estado final: sem fluxo genérico.
  - **Pendência (não-código):** provisionar runtime — secrets da `rpa_ia` + `createCronJob` apontando
    `/tasks/processar` numa versão publicada (spec §10).
- **2026-06-26** — **Pivô para v2 (Conferência de NF por Cupom)**, portando os 4 fluxos n8n
  (`fluxos_n8n/`). Decisões (detalhe e fonte de verdade em `spec-docs/SPEC_CONFERENCIA_V2.md`):
  (a) **substitui** o fluxo genérico do v1 (1 linha = 1 link), reusando a infra (OAuth/Sheets/OCR
  Worker/deploy+cron); remoção progressiva (domínio em C5, wiring API/web em C6 — C0 é aditiva).
  (b) **IA = GoGroup AI Proxy** (gateway OpenAI-compatível; cliente portado de
  `godocs-main/src/lib/llm.ts`, só `fetch`) para **extrair campos da NF** e **mapear
  cabeçalho→colunas** — segredos `LLM_BASE_URL`/`API_PROXY_TOKEN`/`LLM_MODEL`/`LLM_PROVIDER`.
  (c) **Status em 3 níveis**: Aprovado (exato) · Parcial (≤ R$30, `margemParcialCentavos`) · Não
  Aprovado. (d) **Perfis por marca** (base fixa; 1 link de formulário por mês, salvo no banco).
  (e) Download das NFs via **Google Drive** (escopo `drive.readonly`). (f) **Identidade de serviço
  fixa**: o cron acessa Drive/Sheets como **`rpa_ia@gocase.com` via refresh token**
  (`GOOGLE_OAUTH_REFRESH_TOKEN`, consentimento offline 1x, tela de consentimento publicada) — **não**
  OAuth por usuário nem Service Account; reusa o acesso que o n8n já tem. (g) **Sem login Google na
  UI**: acesso gated pelo GoDeploy (`authenticated`); supera a decisão original "OAuth do usuário".
  Gobeaute = esqueleto/task futura. **Nenhuma dependência externa nova** (IA e Drive via `fetch`).
- **2026-06-26 (C3 — Extração de campos)** — implementada em `src/conferencia/extracao/`
  (barril próprio, **fora** do `src/conferencia/index.ts` compartilhado, para não conflitar
  com C1/C2/C4 em paralelo). Decisões da fatia:
  - **`ClienteLlm`** (`cliente-llm.ts`): porte de `godocs-main/src/lib/llm.ts` só com `fetch`
    (Workers-friendly), **config injetada** (`ConfigLlm`, nada de `process.env` no módulo;
    o wiring por env fica na C5). Mantém o tratamento de `unsupported_parameter/value`
    (`dropUnsupportedParam`: gpt-5 usa `max_completion_tokens` e rejeita `temperature` →
    remove e retenta na hora), modo JSON, timeout por `AbortController` e retries de gateway.
    **Não** portamos o fallback "OpenAI direto com chave dedicada" do godocs (resiliência
    específica dele); endpoint único + `gatewayRetries`. **Nunca logamos conteúdo de mensagem**
    (texto da NF = PII, §6).
  - **`ExtratorCampos`** (`extrator-campos.ts`): prompt **verbatim do n8n** (spec §5.4) como
    `system`, texto do OCR como `user`, `temperature: 0` (extração determinística — melhor que
    o n8n, que não fixava) + modo JSON. Retorna **`CamposNfBrutos`** (cru), **não** `CamposNf`:
    a normalização/validação (somenteDigitos, `valorParaCentavos`, DV de CNPJ) é da **C1**
    (mesmo limite que a F5 manteve); campo ausente volta ausente (→ `NAO_LEGIVEL` na C1).
    `parseCamposNf` tolera cercas ```json``` e texto ao redor; lança em conteúdo não-JSON
    (o pipeline da C5 isola a linha — falha isolada §3).
  - **Cache por hash** (`hash.ts`/`cache.ts`): `criarExtracaoNf` faz PDF→texto (**reusa**
    `ocr-worker.ts` da F2)→campos com **cache por SHA-256 do arquivo** (Web Crypto, igual à F4),
    evitando re-OCR e re-IA do mesmo PDF (§7). Cache atrás de interface (`CacheExtracao`): impl
    em memória agora, `env.DB` possível na C5. Aceita `hashConhecido` (o `ArquivoBaixado` da F4
    já traz o hash).
  - **Segredos** no `.env.example` (placeholders): `LLM_BASE_URL`/`API_PROXY_TOKEN`/`LLM_API_KEY`/
    `LLM_MODEL` (default `gpt-4.1-mini`, o do n8n)/`LLM_PROVIDER`. **Nenhuma dependência externa nova.**
- **2026-06-25** — Stack base definida: Node.js + TypeScript, Google Sheets como fonte de
  planilha, Tesseract como OCR inicial (atrás de interface trocável). Pipeline por job
  assíncrono. _(planejamento detalhado pendente)_
- **2026-06-25** — Decisões de escopo do v1 (confirmadas com o usuário):
  - **Fonte da nota:** cada linha traz um **link direto para o arquivo (PDF/XML)**. O v1
    apenas baixa e extrai; **não** há consulta por chave de acesso / SEFAZ (fica para depois).
  - **Devolutiva:** **relatório na tela (web app)** — dashboard de progresso do job +
    resumo ao final. (Resumo na planilha e e-mail ficam como evolução posterior.)
  - **Acesso ao Sheets:** **OAuth Google do usuário** — o usuário faz login com Google e
    autoriza o app a ler/escrever suas planilhas. Exige fluxo OAuth (consent screen) e
    armazenamento seguro de refresh tokens. _(Atualizado: substitui a escolha inicial de
    Service Account.)_
- **2026-06-25** — Desenvolvimento em **git worktrees** (ver seção 7): cada feature é
  construída por um chat do Claude em worktree/branch próprios, para permitir trabalho
  paralelo sem conflito no diretório principal. Todos os worktrees vivem dentro da pasta
  irmã `../analise-notas-fiscais-worktrees/` (uma subpasta por feature), para não poluir o
  diretório pai.
- **2026-06-25** — F1 (parsing) implementada **sem dependência externa** (tudo função pura).
  Convenções fechadas que F2/Extract e os demais devem assumir:
  - **`valorParaCentavos`** — quando há os dois separadores, o **último** é o decimal; com um
    separador único, 3 casas depois dele (ou mais de uma ocorrência) é tratado como **milhar**
    (`"1.234"`→1234,00), senão decimal. Negativo via `-` ou parênteses `(...)`. Arredonda p/ centavo.
  - **`normalizarData`** — janela de ano plausível **2000–2100** é constante (não usa "hoje",
    para a função permanecer pura/determinística). Ajustar a janela aqui se necessário.
- **2026-06-25** — **F3 (Auth + Sheets)** implementada. Decisões da fatia:
  - **Dep nova `googleapis`** (`^173`): SDK oficial do Google para OAuth2 + Sheets API v4.
    Tipos `OAuth2Client`/`Credentials` são **derivados** de `googleapis`
    (`InstanceType<typeof google.auth.OAuth2>`), não importados de `google-auth-library`, para
    evitar erro de tipo entre cópias duplicadas da lib sob `exactOptionalPropertyTypes`.
  - **Coluna de link por cabeçalho:** reconhecida entre `CABECALHOS_LINK`
    (`Link`/`Link Arquivo`/`Link da Nota`/`Link NF`/`Arquivo`/`URL`), case-insensitive — o
    contrato da F0 não fixou um nome. Se nenhum casar, `lerLinhas` devolve `linkArquivo` vazio.
  - **Coluna `Valor` escrita em reais como número** (centavos/100). A unidade **interna**
    segue em centavos (`valorTotalCentavos`, decisão §11/spec); a conversão é só na escrita
    da planilha, que é a superfície que o usuário lê. Campos ausentes viram `""` (limpa
    resíduo → reprocesso idempotente). Escrita sempre via `values.batchUpdate`.
- **2026-06-25 (F5)** — **Fila in-memory no v1** (`FilaEmMemoria`), atrás do contrato
  `JobQueue`. Motivo: o v1 não precisa de infra (Redis) e a interface permite migrar para
  BullMQ/Redis depois sem tocar no pipeline/API (CLAUDE.md §2). FIFO, um job por vez; job que
  falha vira `FALHOU` sem derrubar a fila. **Nenhuma dependência externa nova** foi adicionada
  na F5 (orquestração é puro TS sobre os contratos da F0).
- **2026-06-25 (F5)** — **Validação no pipeline é só estrutural** (`validarNotaExtraida`:
  CNPJ 14 díg., data ISO, valor inteiro ≥0) e fica **local/pura** em `src/pipeline/`. Motivo:
  não acoplar a F5 às funções concretas da F1 (que evolui em paralelo) — só aos contratos da
  F0. A validação fiscal forte (DV de CNPJ/CPF, plausibilidade) é responsabilidade da F1/F2,
  sinalizada via `NotaExtraida.avisos`/`confianca`. **Concorrência padrão de linhas = 4**
  (`CONCORRENCIA_PADRAO`, sobrescrevível por `opts.concorrencia`).
- **2026-06-25 (F6 / Plataforma)** — **Alvo de deploy: GoDeploy (Cloudflare Workers)**, app SPA.
  Decisão fundamental, confirmada com o usuário ("o deploy no GoDeploy não é adiável"). O v1
  roda como **Worker stateless**. Implicações (origem da task **FUND — Migração**):
  - **Processamento por `env.DB` + cron** (substitui a `FilaEmMemoria` da F5, que depende de
    loop em background — inexistente no Workers): `POST /api/jobs` só **persiste** o job e suas
    linhas (`PENDENTE`) no SQLite embutido (`env.DB`) e responde na hora; um **cron trigger** do
    GoDeploy avança **N linhas por tick** (lote), grava resultado na planilha e marca
    `CONCLUIDO`/`ERRO`. Aguenta planilha grande e se retoma sozinho. O contrato `JobQueue` da F0
    é preservado (a F6 adiciona a impl sobre o banco; a in-memory segue para uso em Node/teste).
    **Atenção ao modelo de cron do GoDeploy:** NÃO é um handler `scheduled`/`setInterval` — a
    plataforma faz **POST numa rota** do app (aqui `/tasks/processar`) com header assinado
    `X-Godeploy-Cron`, validado contra `env.GODEPLOY_CRON_KEY`. O `createCronJob` (MCP) agenda
    a chamada; a rota precisa já existir numa versão publicada.
  - **SDKs Node → `fetch`/REST:** `googleapis` (F3) e `node:dns` (F4) **não rodam** no Workers.
    A F6 traz implementações **Workers-native** de `GoogleAuthProvider` e `SheetsClient` via
    `fetch` (OAuth2 token endpoint + Sheets REST v4), reaproveitando os helpers **puros** de
    `src/sheets/colunas.ts` e `src/sheets/spreadsheet-id.ts`. As impls googleapis (F3) seguem
    no repo, mas são **superadas** no deploy. `pdf-parse`/Tesseract (F2) → ver OCR abaixo.
  - **OCR via HTTP externo:** sem binário nativo no Workers, o PDF é extraído pelo **Cloudflare
    OCR Worker** (F2 revisão #9). **Atualização (2026-06-25):** os stubs `Indisponivel` foram
    **substituídos pelos provedores reais** em `src/api/deps.ts` (`montarDeps(sheets, env)`):
    `FileFetcherWorkers` (download só com `fetch` + Web Crypto) + `criarNotaExtractor({ ocrWorker })`
    lendo `env.OCR_WORKER_URL`/`OCR_WORKER_TOKEN`. SSRF no edge sem `node:dns`: bloqueia IP literal
    interno + hostnames internos por nome (`localhost`/`.local`/`.internal`/metadados), confiando no
    isolamento de rede do edge + `redirect:'error'` para o resto (pinagem de IP fica p/ depois).
  - **Sessão por cookie assinado (HMAC via Web Crypto `crypto.subtle`)** — sem dep externa.
    Tokens OAuth do usuário guardados no `env.DB` (nunca commitados; CLAUDE.md §6).
  - **Sem dependência externa nova** na F6: worker e SPA são TS/JS puro + builtins (`fetch`,
    `crypto`, `URL`); `env.DB`/cron são da plataforma. Tipos do Workers (`Env`, `DB`,
    `ExecutionContext`) declarados localmente para o `tsc` (gate) não exigir `@cloudflare/workers-types`.
- **2026-06-25 (F2)** — **Extract** implementada em cascata XML → texto do PDF → OCR
  (`src/extract/`). Decisões da fatia:
  - **Deps novas:** `fast-xml-parser` (`^4`, parse do XML da NF-e — `parseTagValue`/
    `parseAttributeValue` **desligados** para não perder zeros à esquerda de CNPJ nem
    reformatar valores), `pdf-parse` (`^1`, camada de texto do PDF — importado direto de
    `pdf-parse/lib/pdf-parse.js` via `createRequire` para fugir do bloco de debug do
    `index.js`), `tesseract.js` (`^5`, OCR `por`, atrás de `OcrProvider`), e para rasterizar
    PDF escaneado p/ o OCR: `pdfjs-dist` (`^4`) + `@napi-rs/canvas` (`^0.1`, binários
    pré-compilados — instala no Windows sem toolchain nativa).
  - **F2 consome os validadores da F1** (`validarCnpj`/`validarCpf`/`valorParaCentavos`/
    `normalizarData`) em `montar.ts` — diferente da F5, que ficou desacoplada de propósito.
  - **Dependências de I/O injetáveis** (`DependenciasExtractor`: `lerTextoPdf`, `rasterizar`,
    `ocr`): o orquestrador é fino e testável com fakes; as libs pesadas (pdf-parse/pdfjs/
    canvas/tesseract) ficam nas bordas e o rasterizador é carregado por **import dinâmico**.
  - **Confiança** = peso da fonte (XML 1.0 · PDF_TEXTO 0.85 · OCR = confiança do motor) ×
    fração dos 3 campos críticos (CNPJ, data, valor) válidos. Campo faltante/inválido vira
    `aviso` em vez de derrubar a extração — `extrair` **nunca lança** (falha isolada, §3).
  - **Cascata por fonte mais confiável** (§1): XML > camada de texto do PDF (≥20 chars úteis e
    algum campo aproveitável) > OCR (PDF escaneado). Tipo do arquivo detectado por `tipo` +
    sniff do conteúdo (`%PDF`, `<?xml`/`<`).
- **2026-06-25 (F2 — revisão da extração de PDF)** — **PDF passa a ser extraído pelo Cloudflare
  OCR Worker** (mesmo worker já usado em produção no godocs). Decidido com o usuário; substitui
  a forma "manual" local. Impactos:
  - **Cascata simplificada:** XML → **OCR Worker** (o worker faz camada de texto **e** OCR de
    escaneados num passo só). Sumiram o degrau de OCR local e a distinção PDF_TEXTO/OCR — o
    texto do worker é tratado como `PDF_TEXTO` (peso 0.85).
  - **Deps REMOVIDAS:** `pdf-parse`, `tesseract.js`, `pdfjs-dist`, `@napi-rs/canvas` (e os
    arquivos `pdf.ts`/`rasterizar.ts`/`tesseract-ocr.ts`). Resta só `fast-xml-parser` para o XML.
  - **Borda HTTP** em `src/extract/ocr-worker.ts` → `criarLeitorPdf(config)`: `POST` com
    `Content-Type: application/pdf` + `Authorization: Bearer <token>` e os bytes do PDF;
    resposta `{ text? | content? }`; timeout via `AbortController` (default 60s).
  - **Config/segredo:** `ConfigOcr` virou `{ workerUrl, workerToken, timeoutMs }`
    (`OCR_WORKER_URL`/`OCR_WORKER_TOKEN`/`OCR_WORKER_TIMEOUT_MS`). **`OCR_WORKER_TOKEN` é
    segredo** — só no `.env` real (placeholder no `.env.example`); nunca commitar (§6).
  - **`OcrProvider`/`ResultadoOcr`** (contrato da F0) ficam declarados mas **sem implementação
    local** no v1 — reservados para um provider local futuro.
  - **Trade-off aceito:** sem fallback de OCR local — se o worker cair, a linha vira `ERRO`
    isolado (não derruba o lote).
- **2026-06-25 (F4)** — **Download implementado sem dependência externa nova** (só builtins do
  Node: `node:crypto`, `node:dns/promises`, `fetch` global). Decisões da fatia:
  - **SSRF guard puro** (`ssrf.ts`): só `http`/`https`; `ipBloqueado` classifica IPv4 **e** IPv6
    (privado/loopback/link-local/CGNAT/multicast/reservado, IPv4-mapped `::ffff:` e zona `%`).
    **Fail-safe:** IP não interpretável é bloqueado. O `FileFetcher` resolve o DNS e bloqueia se
    **qualquer** IP resolvido for interno.
  - **`fetch` com `redirect: 'error'`** — um redirect escaparia da checagem de SSRF.
  - **`maxBytes` aplicado em dobro:** corte cedo por `Content-Length` **e** contagem durante o
    stream (servidor pode mentir/omitir o header).
  - **Cache de download por URL** (não por hash do conteúdo — o hash só é conhecido depois de
    baixar): o mesmo link não é rebaixado na mesma instância. O `hash` SHA-256 segue no
    `ArquivoBaixado` para o cache de OCR/extração da F2.
  - **Limitação conhecida (documentada no código):** guard e `fetch` resolvem DNS em momentos
    distintos (janela de DNS-rebinding). Aceitável no v1; mitigar depois pinando o IP na conexão.
