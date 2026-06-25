# Spec — Fatias do v1 (Análise de Notas Fiscais) · jun/2026

> **Documento vivo.** Decisões fechadas com o usuário em 2026-06-25. Mantido em
> `spec-docs/` (versionado no repo).
> **Status global (2026-06-25): F0 (Fundação), F1 (Parsing/validação), F3 (Auth + Sheets) e
> F5 (Pipeline + Queue) MERGEADAS** (PRs #1, #3, #5 e #4, na `main`); **F4 (Download)** com PR
> aberto (branch `feat/download`). **F2 (Extract) e F6 (API + Web)** ainda a fazer. Sem deploy
> ainda (projeto em construção).

## Visão geral

O v1 é dividido em **fatias independentes**, **uma por worktree/branch/PR** (regra de
worktrees no CLAUDE.md §7). A **F0** define os contratos (tipos + interfaces em `src/`); as
demais implementam contra esses contratos e podem rodar **em paralelo** (vários chats do
Claude ao mesmo tempo). Cada fatia é reconciliada com o `main` da vez antes do merge.

**Ordem sugerida:** F0 ✅ → **F1** ✅ → **F3 + F4 em paralelo** (independentes) → **F2** (após F1) →
**F5** (após F2/F3/F4) → **F6** (fecha).

| # | Fatia | Status | Depende de | PR |
|---|-------|--------|-----------|----|
| F0 | **Fundação** (tsconfig strict, tipos, interfaces, `loadConfig`) | ✅ mergeada | — | #1 |
| F1 | **Parsing/validação** (CNPJ/CPF DV, valor→centavos, data→ISO) | ✅ mergeada | F0 | #3 |
| F2 | **Extract** (cascata XML → pdf-parse → OCR) | ⬜ a fazer | F0, F1 | — |
| F3 | **Auth + Sheets** (OAuth Google, ler/escrever em lote por cabeçalho) | ✅ mergeada | F0 | #5 |
| F4 | **Download** (`FileFetcher` + SSRF guard, limites, cache por hash) | 🟦 PR aberto | F0 | `feat/download` |
| F5 | **Pipeline + Queue** (orquestração por linha/job, idempotência) | ✅ mergeada | F0 (F2/F3/F4 via interface) | #4 |
| F6 | **API + Web** (endpoints + tela de login/link/progresso = devolutiva) | ⬜ a fazer | F0, F5 | — |

**Critério de "verde" (gate de pronto)** por fatia: `npm run typecheck` sem erros (a F0
deixou **0 erros**; qualquer erro novo é da fatia) · `npm test` tudo verde · `npm run build` ok.

---

## Decisões fechadas que NÃO podem ser "corrigidas" por engano

1. **Fonte da nota = link direto (PDF/XML)** por linha. O v1 **não** consulta por chave de
   acesso / SEFAZ — isso fica para depois. Não introduzir integração fiscal no v1.
2. **Devolutiva = relatório na tela (web)** — daí o tipo `ProgressoJob`. Resumo na planilha e
   e-mail são evolução posterior; não assumir que já existem.
3. **Acesso ao Sheets = OAuth do usuário** (NÃO Service Account — escolha revista em
   2026-06-25). Guardar refresh tokens com segurança; nunca commitar.
4. **Valores monetários em centavos (inteiro)**, datas em ISO 8601, CNPJ/CPF só dígitos. A
   formatação para exibição é responsabilidade do frontend (CLAUDE.md §5). Não trocar a
   unidade de `valorTotalCentavos` para decimal "porque é mais fácil".
5. **Contratos primeiro:** as fatias implementam as interfaces da F0 (`src/`). Mudar uma
   assinatura de interface é decisão de arquitetura — discutir e registrar aqui + CLAUDE.md
   antes, porque afeta os outros chats em paralelo.

---

## Contrato com a planilha (match por NOME de cabeçalho, não posição)

Constante `COLUNAS` em `src/types/linha.ts`. Colunas escritas pelo sistema:
`Status` · `CNPJ Emitente` · `Data Emissão` · `Valor` · `Erro` · `Processado em`.
Reordenar na planilha não quebra; coluna ausente é **criada** (`SheetsClient.garantirColunas`,
F3). Nunca destruir dados do usuário (CLAUDE.md §4). Status por linha:
`PENDENTE → PROCESSANDO → CONCLUIDO | ERRO`.

---

## F0 — Fundação ✅ (feito)

**O quê:** o esqueleto TypeScript + os **contratos** (tipos compartilhados e interfaces de
cada camada) que destravam o desenvolvimento paralelo das demais fatias.

**Onde aterrissou** (worktree `../analise-notas-fiscais-worktrees/fundacao`, branch
`feat/fundacao`, PR #1, mergeado em `c45dd8b` — typecheck limpo, 4/4 testes):
- **Build/infra:** `tsconfig.json` (`strict` + `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); `package.json` (`type: module`,
  Vitest, scripts `build`/`typecheck`/`test`); `.env.example` migrado para OAuth.
- **Tipos compartilhados** (`src/types/`): `nota.ts` (`Nota`, `NotaExtraida`, `FonteDados`),
  `arquivo.ts` (`ArquivoBaixado`, `TipoArquivo`), `linha.ts` (`StatusLinha`, `COLUNAS`,
  `MapaColunas`, `LinhaEntrada`, `LinhaResultado`), `job.ts` (`Job`, `ProgressoJob`,
  `StatusJob`), `google.ts` (`TokensGoogle`), `index.ts` (barril).
- **Interfaces por camada** (a implementar pelas fatias):
  - `src/auth/index.ts` → `GoogleAuthProvider`
  - `src/sheets/index.ts` → `SheetsClient`, `LeituraPlanilha`, `CriarSheetsClient`, `ExtrairSpreadsheetId`
  - `src/download/index.ts` → `FileFetcher`, `OpcoesDownload`
  - `src/extract/index.ts` → `NotaExtractor`, `OcrProvider`, `ResultadoOcr`
  - `src/parsing/index.ts` → contratos das funções puras (`ValidarCnpj`, `ValidarCpf`, `SomenteDigitos`, `ValorParaCentavos`, `NormalizarData`)
  - `src/pipeline/index.ts` → `DependenciasPipeline`, `ProcessarLinha`, `ProcessarJob`, `OnProgresso`
  - `src/queue/index.ts` → `JobQueue`, `JobHandler`
- **`src/config/index.ts`** (única implementação concreta): `loadConfig` tipado — lê env,
  valida números, exige OAuth em produção. `src/index.ts` re-exporta tudo.
- **Testes:** `test/config.test.ts` (4 casos: defaults, conversão, número inválido, OAuth-em-prod).

---

## F1 — Parsing/validação ✅ (feito · PR #3)

**O quê:** funções **puras** (sem I/O) de parsing/validação — a parte com mais regras e casos
de borda (CLAUDE.md §7). Implementa os contratos de `src/parsing/index.ts`.

**Onde aterrissou** (worktree `../analise-notas-fiscais-worktrees/parsing`, branch
`feat/parsing`, PR #3 — typecheck 0 erros, 32 testes verdes, build ok):
- **`src/parsing/index.ts`** — agora contém os **contratos (tipos)** da F0 **e** a
  implementação concreta: `somenteDigitos`, `validarCnpj`, `validarCpf`, `valorParaCentavos`,
  `normalizarData`. Sem nenhuma dependência externa nova (tudo é função pura).
- **CNPJ/CPF:** validação pelos dois dígitos verificadores (módulo 11), aceitando com/sem
  máscara; rejeita comprimento errado e sequências de dígito repetido (`000…`, `111…`).
- **`valorParaCentavos`:** inteiro em **centavos**. Lida com `R$`/letras/espaços, decimal `,`
  ou `.` (o **último** separador é o decimal quando há os dois), milhar removido, negativo
  (`-` ou parênteses contábeis). Heurística de separador único: 3 casas após ele ou mais de
  uma ocorrência ⇒ **milhar** (`"1.234"`→1234,00); senão decimal (`"12,5"`→12,50). Arredonda
  para centavos. `null` quando não há dígito.
- **`normalizarData`:** saída `YYYY-MM-DD`. Aceita ISO (com hora/`T`), BR `DD/MM/YYYY` (`/ - .`)
  e ano de 2 dígitos (século 2000). Valida calendário real (inclui bissexto) e janela
  plausível de ano **2000–2100** (constante, sem depender de "hoje", p/ manter a função pura);
  `null` fora disso.
- **Testes:** `test/parsing.test.ts` (28 casos). Vetores de CNPJ/CPF inline e anonimizados —
  não foi preciso `test/fixtures/` (sem arquivos; fixtures de nota ficam para a F2/Extract).
- **Barril:** `src/index.ts` passou a re-exportar as funções (value export) além dos tipos.

---

## F2 — Extract ⬜ (depende de F1)

**O quê:** `NotaExtractor` em cascata XML da NF-e → texto do PDF (`pdf-parse`) → OCR
(`OcrProvider`/Tesseract `por`), da fonte mais confiável para a menos (CLAUDE.md §1). Consome
os validadores da F1.

**Onde mexer (planejado):**
- `src/extract/` — implementar `NotaExtractor` e ao menos um `OcrProvider` (Tesseract).
- Dependência nova de OCR/PDF (ex.: `tesseract.js`, `pdf-parse`) → **registrar o porquê** em
  CLAUDE.md §11 (Decisões). Pré-processar imagem antes do OCR (deskew/binarização/DPI).
- Marcar baixa confiança em `NotaExtraida.avisos` em vez de gravar lixo. Testes com fixtures.

---

## F3 — Auth + Sheets ✅ (feito · branch `feat/auth-sheets`)

**O quê:** `GoogleAuthProvider` (fluxo OAuth do usuário) + `SheetsClient` (ler linhas, achar/
criar colunas por cabeçalho, escrever em lote). Implementa `src/auth` e `src/sheets`.

**Onde aterrissou** (worktree `../analise-notas-fiscais-worktrees/auth-sheets`, branch
`feat/auth-sheets` — typecheck 0 erros, 30/30 testes, build ok):
- **Dep nova:** `googleapis` (`^173`) — ver decisão em CLAUDE.md §11.
- **`src/auth/`** — `google-auth-provider.ts`: `GoogleAuthProviderImpl`
  (`getAuthUrl`/`exchangeCode`/`refresh`), escopo `spreadsheets`,
  `access_type: 'offline'` + `prompt: 'consent'` (garante refresh token);
  `mapearCredenciais` (Google → `TokensGoogle`, respeitando `exactOptionalPropertyTypes`);
  `criarGoogleAuthProvider`. Tipos `OAuth2Client`/`Credentials` derivados de `googleapis`
  (`InstanceType<typeof google.auth.OAuth2>`) para evitar conflito de cópias duplicadas de
  `google-auth-library`.
- **`src/sheets/`** — `sheets-client.ts`: `SheetsClientImpl` sobre Sheets API v4
  (`lerLinhas`, `garantirColunas`, `escreverResultados` via **`values.batchUpdate`**),
  fábricas `criarSheetsClient` (só access token) e `criarSheetsClientCom(config)` (com
  auto-refresh). `spreadsheet-id.ts`: `extrairSpreadsheetId`. `colunas.ts`: lógica **pura e
  testável** — `construirMapaColunas`, `acharColuna`/`acharColunaLink` (case-insensitive),
  `colunaParaA1`, `centavosParaReais`, `resultadoParaCelulas`.
- **Convenções decididas (ver §Contrato e CLAUDE.md §11):** coluna de link reconhecida por
  cabeçalho entre `CABECALHOS_LINK` (`Link`/`Link Arquivo`/`Link da Nota`/`Link NF`/`Arquivo`/
  `URL`); a coluna `Valor` é escrita em **reais como número** (centavos/100) — formatação
  amigável para a planilha, sem mexer na unidade interna `valorTotalCentavos`. Campos
  ausentes são escritos como `""` (limpa resíduo → reprocesso idempotente). Nunca toca em
  colunas fora de `COLUNAS`.
- **Testes:** `test/spreadsheet-id.test.ts`, `test/colunas.test.ts`, `test/google-auth.test.ts`
  (URL de consentimento + mapeamento de credenciais), `test/sheets-client.test.ts` (fake da
  Sheets API: leitura, criação de colunas, escrita em lote).

---

## F4 — Download 🟦 (PR aberto · branch `feat/download`)

**O quê:** `FileFetcher` que baixa o PDF/XML do link da linha, com os cuidados de segurança.
Implementa `src/download`.

**Onde aterrissou** (worktree `../analise-notas-fiscais-worktrees/download`, branch
`feat/download` — typecheck 0 erros, 24 testes novos (96 no total), build ok):
- **Sem dependência externa nova** — usa só os builtins do Node (`node:crypto` p/ SHA-256,
  `node:dns/promises` p/ resolver o host, `fetch` global p/ a requisição).
- **`src/download/ssrf.ts`** — guarda **pura e testável**: `validarUrl` (só `http`/`https`,
  senão `DestinoBloqueadoError`), `ipBloqueado` (classifica IPv4 **e** IPv6 como interno/
  privado/loopback/link-local/CGNAT/multicast/reservado, inclusive IPv4 mapeado em IPv6
  `::ffff:…` e zona de escopo `%eth0`). **Fail-safe:** IP que não consegue interpretar é
  bloqueado.
- **`src/download/tipo-arquivo.ts`** — `detectarTipo` (puro): assinatura do **conteúdo** primeiro
  (`%PDF-`, `<?xml`/raiz NF-e), `Content-Type` como desempate; `desconhecido` quando nada bate.
  Conteúdo vence header mentiroso.
- **`src/download/file-fetcher.ts`** — `FileFetcherImpl`/`criarFileFetcher`: valida URL → resolve
  DNS e bloqueia se **qualquer** IP resolvido for interno → `fetch` com `redirect: 'error'`
  (redirect burlaria o guard) e `AbortController` (timeout) → lê o corpo **respeitando `maxBytes`**
  (corta cedo por `Content-Length` e também durante o stream) → SHA-256 + tipo. **Cache por URL**
  (não rebaixa o mesmo link). Erros acionáveis via `DownloadError` (HTTP de erro, tamanho
  excedido, timeout) e `DestinoBloqueadoError`. `fetch`/DNS são **injetáveis** (testes sem rede).
- **Limitação conhecida (registrada no código):** o guard e o `fetch` resolvem o DNS em momentos
  distintos (janela de **DNS-rebinding**). Aceitável no v1; mitigar depois pinando o IP resolvido
  na conexão.
- **Testes:** `test/ssrf.test.ts` (esquemas + faixas IPv4/IPv6 + fail-safe), `test/tipo-arquivo.test.ts`,
  `test/file-fetcher.test.ts` (fakes de `fetch`/DNS: happy path + hash, cache, esquema bloqueado,
  SSRF, `maxBytes` por header e por stream, HTTP 404, timeout). **Sem libs externas, sem rede real.**

---

## F5 — Pipeline + Queue 🟦 (PR aberto · branch `feat/pipeline-queue`)

**O quê:** orquestração — `ProcessarLinha`/`ProcessarJob` + `JobQueue`. Junta sheets+download+
extract atrás das interfaces. Implementa `src/pipeline` e `src/queue`. **Não depende das
implementações concretas de F2/F3/F4** — só dos contratos da F0 (por isso pôde ser feita antes
delas, com fakes nos testes).

**Onde aterrissou** (worktree `../analise-notas-fiscais-worktrees/pipeline-queue`,
branch `feat/pipeline-queue` — typecheck limpo, 18/18 testes, build ok):
- `src/pipeline/`:
  - `processar-linha.ts` → `processarLinha`: baixa → extrai → **valida (estrutural)** → devolve
    `LinhaResultado`. **Nunca lança** — qualquer erro vira status `ERRO` com mensagem acionável
    (falha isolada, CLAUDE.md §3).
  - `processar-job.ts` → `processarJob`: lê a planilha, `garantirColunas(Object.values(COLUNAS))`,
    **idempotência** (pula `CONCLUIDO`), marca `PROCESSANDO` **em lote antes** de processar
    (anti-corrida), processa com **concorrência limitada** (`CONCORRENCIA_PADRAO=4`), grava o
    resultado final em lote (`escreverResultados`, nunca célula a célula). Emite `onProgresso`
    por linha (status inicial e final; inclui as já concluídas no total).
  - `validacao.ts` → `validarNotaExtraida` (estrutural: CNPJ 14 díg., data ISO, valor inteiro
    ≥0). **Pura e local de propósito** — a F5 não importa as funções concretas da F1 (que evolui
    em paralelo); a validação fiscal forte é da F1/F2 (via `avisos`/`confianca`).
  - `concorrencia.ts` → `processarComConcorrencia` (pool ordenado) + `agora()` (ISO 8601).
- `src/queue/` → `fila-em-memoria.ts` → `FilaEmMemoria` (`JobQueue` **in-memory**, FIFO, um job
  por vez; job que falha vira `FALHOU` sem derrubar a fila). Ponto de costura com a F6:
  `onProgressoDe(jobId)` devolve um `OnProgresso` que alimenta o `progresso()` agregado.
- **Testes** (`test/`): `processar-linha`, `processar-job` (idempotência, falha isolada, ordem
  das escritas, `garantirColunas`, progresso), `fila-em-memoria`; fakes em `test/helpers/fakes.ts`
  (Sheets/Fetcher/Extractor) — **sem libs externas e sem dados reais**.

**Costura para a F6** (referência):
```ts
const fila = new FilaEmMemoria();
fila.processar((job) => processarJob(job, deps, { onProgresso: fila.onProgressoDe(job.id) }));
await fila.enfileirar(job);
// ... fila.progresso(job.id) -> ProgressoJob (devolutiva na tela)
```

---

## F6 — API + Web ⬜ (fecha o v1)

**O quê:** HTTP (criar job, consultar progresso) + frontend (login Google, colar link, ver
progresso e resumo = a **devolutiva na tela**). Consome F5.

**Onde mexer (planejado):**
- `src/api/` — endpoints (sugestão **Fastify** — confirmar e registrar em §11): criar job,
  callback OAuth, progresso (polling/SSE). `src/web/` — telas.
- Validar link da planilha como **não confiável** (CLAUDE.md §6). Tratar planilha como API pública.

---

## Como retomar numa nova sessão (runbook)

1. **Ler este doc + a memória** (`fatias-v1-spec-junho-2026`).
2. **Sincronizar antes de tudo:** na `main`, `git fetch origin` + `git pull --ff-only origin main`.
3. **Para cada fatia nova:** criar worktree próprio a partir do `main` atualizado
   (CLAUDE.md §7), **dentro da pasta-contêiner**:
   `git worktree add ../analise-notas-fiscais-worktrees/<fatia> -b feat/<fatia> main`.
   Rodar `npm install` no worktree (ou criar junction do `node_modules` para não reinstalar:
   `cmd //c "mklink /J ..\\analise-notas-fiscais-worktrees\\<fatia>\\node_modules ..\\..\\analise-notas-fiscais\\node_modules"`).
4. **Gate antes de considerar pronto:** `npm run typecheck` (0 erros — a F0 deixou base limpa) ·
   `npm test` (verde) · `npm run build` (ok).
5. **Obrigatório (CLAUDE.md):** texto PT-BR com acento · atualizar **este spec** (status +
   "Onde aterrissou") e o CLAUDE.md no mesmo PR · registrar dep nova em §11 · `git pull` antes
   de abrir PR · um chat = uma fatia.

### Reconcile de uma branch com o `main` (sem commitar o WIP)

```
cd ../analise-notas-fiscais-worktrees/<fatia>
git stash push -u -m wip
git merge --ff-only main      # ou: git rebase main
git stash pop                 # reaplica; resolve conflitos se houver
```

**Conflitos recorrentes esperados** (triviais — manter as DUAS adições):
- `src/index.ts` — barril de re-exports (cada fatia adiciona seus exports).
- `package.json` — `dependencies` (cada fatia anexa libs).
- `spec-docs/SPEC_FATIAS_V1.md` — tabela de status (várias fatias atualizam).
- `CLAUDE.md` — §10 roadmap / §11 decisões.

## Estado dos worktrees (no momento deste doc)

- **F4 (`download`, branch `feat/download`)** aberto durante a entrega desta fatia (remover após
  o merge). Já removidos após o merge: F0 (`fundacao`, PR #1), F5 (`pipeline-queue`, PR #4),
  F3 (`auth-sheets`, PR #5) e F1 (`parsing`, PR #3).

> Ciclo de vida: enquanto as fatias vão sendo entregues, este spec é a bússola entre
> sessões/PRs. Quando o v1 fechar, ele pode ser removido ou virar doc permanente em `docs/`.
