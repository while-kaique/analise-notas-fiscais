# Spec — Fatias do v1 (Análise de Notas Fiscais) · jun/2026

> **Documento vivo.** Decisões fechadas com o usuário em 2026-06-25. Mantido em
> `spec-docs/` (versionado no repo).
> **Status global (2026-06-25): F0 (Fundação) e F1 (Parsing/validação) MERGEADAS**
> (PRs #1 e #3, na `main`). F2–F6 ainda não começaram. Sem deploy ainda (projeto em construção).

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
| F3 | **Auth + Sheets** (OAuth Google, ler/escrever em lote por cabeçalho) | ⬜ a fazer | F0 | — |
| F4 | **Download** (`FileFetcher` + SSRF guard, limites, cache por hash) | ⬜ a fazer | F0 | — |
| F5 | **Pipeline + Queue** (orquestração por linha/job, idempotência) | ⬜ a fazer | F0, F2, F3, F4 | — |
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

## F3 — Auth + Sheets ⬜ (paraleliza com F1/F4)

**O quê:** `GoogleAuthProvider` (fluxo OAuth do usuário) + `SheetsClient` (ler linhas, achar/
criar colunas por cabeçalho, escrever em lote). Implementa `src/auth` e `src/sheets`.

**Onde mexer (planejado):**
- Dependência `googleapis`. `src/auth/` → OAuth (getAuthUrl/exchangeCode/refresh), escopo
  `spreadsheets`. `src/sheets/` → `lerLinhas`, `garantirColunas`, `escreverResultados`
  (**batchUpdate**, nunca célula a célula), `extrairSpreadsheetId`.
- Guardar refresh tokens com segurança (nunca commitar). Identificar coluna por **nome**.
- Decidir framework só se necessário; registrar dep nova em CLAUDE.md §11. Testes do mapa de colunas.

---

## F4 — Download ⬜ (paraleliza com F1/F3)

**O quê:** `FileFetcher` que baixa o PDF/XML do link da linha, com os cuidados de segurança.
Implementa `src/download`.

**Onde mexer (planejado):**
- `src/download/` — `baixar(url)`: **SSRF guard** (bloquear IPs internos/localhost/link-local;
  só http/https), respeitar `maxBytes`/`timeoutMs`, detectar tipo, calcular SHA-256 (cache).
- Erros acionáveis (link morto, tamanho excedido, timeout, destino bloqueado). Testes do guard.

---

## F5 — Pipeline + Queue ⬜ (depende de F2/F3/F4)

**O quê:** orquestração — `ProcessarLinha`/`ProcessarJob` + `JobQueue`. Junta sheets+download+
extract atrás das interfaces. Implementa `src/pipeline` e `src/queue`.

**Onde mexer (planejado):**
- `src/pipeline/` — por linha: marca `PROCESSANDO`, baixa → extrai → valida → escreve;
  **idempotência** (pula `CONCLUIDO`), **falha isolada** (erro vira `LinhaResultado` ERRO, não
  derruba o lote), concorrência limitada, escrita em lote. `onProgresso` alimenta a devolutiva.
- `src/queue/` — fila + progresso. v1 pode ser **in-memory** atrás de `JobQueue` (decidir; se
  for BullMQ/Redis, registrar em CLAUDE.md §11). Testes de idempotência/falha isolada.

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

- Nenhum worktree de feature aberto após o merge da F1. O da F0
  (`../analise-notas-fiscais-worktrees/fundacao`) e o da F1
  (`../analise-notas-fiscais-worktrees/parsing`) foram removidos após o merge dos PRs #1 e #3.

> Ciclo de vida: enquanto as fatias vão sendo entregues, este spec é a bússola entre
> sessões/PRs. Quando o v1 fechar, ele pode ser removido ou virar doc permanente em `docs/`.
