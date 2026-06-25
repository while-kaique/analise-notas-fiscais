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
| **F2 — Extract** | `NotaExtractor` cascata XML → pdf-parse → OCR (`OcrProvider`/Tesseract `por`) | F0, F1 | ⬜ A fazer |
| **F3 — Auth + Sheets** | `GoogleAuthProvider` (OAuth), `SheetsClient` (ler/escrever em lote por cabeçalho) | F0 | ✅ PR #5 mergeada |
| **F4 — Download** | `FileFetcher` com SSRF guard, limites, cache por hash | F0 | ⬜ A fazer |
| **F5 — Pipeline + Queue** | `ProcessarLinha`/`ProcessarJob` (idempotência, falha isolada), `JobQueue` | F0 (F2/F3/F4 via interface) | ✅ PR #4 mergeada |
| **F6 — API + Web** | Worker GoDeploy (SPA + rotas) + processamento por cron sobre `env.DB` | F0, F5 | 🟦 PR aberto (`feat/api-web`) |
| **FUND — Migração GoDeploy/Workers** | reestruturar runtime p/ Cloudflare Workers (fila→`env.DB`+cron, SDKs Node→`fetch`/REST, OCR→HTTP) | F3, F4, F5 | 🟦 em andamento (iniciada na F6) |

**Ordem sugerida:** mergear F0 → atacar **F1** e **F3/F4** em paralelo (não dependem entre
si) → F2 (após F1) → F5 (após F2/F3/F4) → F6 (fecha). Frameworks ainda **a confirmar** por
fatia: fila (no v1 = `env.DB`+cron do GoDeploy, atrás do contrato `JobQueue`), testes (Vitest,
já no F0). Registre a escolha em §11 ao implementar.

> **Plataforma alvo (decisão 2026-06-25, ver §11): GoDeploy / Cloudflare Workers**, app SPA.
> Runtime **stateless e sem processo em background** — daí a fila virar `env.DB`+cron e os SDKs
> Node (`googleapis`, `pdf-parse`, `node:dns`) precisarem migrar para `fetch`/REST (task **FUND**).

## 11. Decisões (log)

> Registre aqui decisões de arquitetura/stack com data e motivo. Ex.:
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
  - **SDKs Node → `fetch`/REST:** `googleapis` (F3) e `node:dns` (F4) **não rodam** no Workers.
    A F6 traz implementações **Workers-native** de `GoogleAuthProvider` e `SheetsClient` via
    `fetch` (OAuth2 token endpoint + Sheets REST v4), reaproveitando os helpers **puros** de
    `src/sheets/colunas.ts` e `src/sheets/spreadsheet-id.ts`. As impls googleapis (F3) seguem
    no repo, mas são **superadas** no deploy. `pdf-parse`/Tesseract (F2) → ver OCR abaixo.
  - **OCR via HTTP externo:** sem binário nativo no Workers, o `OcrProvider` da F2 deve apontar
    para um serviço HTTP (Cloud Vision/Textract). A interface já permite; nenhuma mudança de
    contrato. No v1 da F6, `FileFetcher`/`NotaExtractor` entram **via interface** (stubs
    acionáveis até F2/F4 ganharem versões Workers-native).
  - **Sessão por cookie assinado (HMAC via Web Crypto `crypto.subtle`)** — sem dep externa.
    Tokens OAuth do usuário guardados no `env.DB` (nunca commitados; CLAUDE.md §6).
  - **Sem dependência externa nova** na F6: worker e SPA são TS/JS puro + builtins (`fetch`,
    `crypto`, `URL`); `env.DB`/cron são da plataforma. Tipos do Workers (`Env`, `DB`,
    `ExecutionContext`) declarados localmente para o `tsc` (gate) não exigir `@cloudflare/workers-types`.
