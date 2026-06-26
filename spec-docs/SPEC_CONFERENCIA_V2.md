# Spec — v2 · Conferência de NF por Cupom (migração do n8n) · jun/2026

> **Documento vivo.** Planejamento fechado com o usuário em **2026-06-26**. Versionado em
> `spec-docs/`. Sucede o **[`SPEC_FATIAS_V1.md`](SPEC_FATIAS_V1.md)** (v1 **fechado** e que será
> **substituído** — ver §1). Memória pareada de handoff: `conferencia-v2-spec-junho-2026`.
>
> **Status global (2026-06-26): C0, C1 e C2 mergeadas** (PRs #13 / #15 / #14); **C3 (extração)
> e C4 (drive) em andamento** (worktrees `feat/conferencia-extracao` e `feat/conferencia-drive`).
> Origem:
> 4 fluxos n8n em `fluxos_n8n/` (Gocase: Influs, Assessoria, Soma, Embaixador) portados para o
> sistema, **melhores/mais rápidos**, e generalizados para outras marcas (Gobeaute) via IA de
> mapeamento de colunas.

---

## 1. O que muda do v1 (decisão: **substituir de vez**)

O **v1** (F0–F6, deployado no GoDeploy app `687dbb00`) é um **extrator genérico**: o usuário cola
1 planilha, **cada linha tem um link direto** para um PDF/XML, baixa, extrai 3 campos
(CNPJ/Data/Valor) e grava na mesma linha. Ele **não** conhece cupom, marca, base com valor
esperado, retroativo, influ/assessoria nem soma.

O produto real (n8n) é outro: **conferência de notas por cupom** — validar que influencers/
embaixadores enviaram a NF correta, cruzando o **FORMULÁRIO** (NF + cupom) com a **BASE/CONTROLE**
(valor esperado por cupom × mês), por marca, com **retroativo** e **soma**.

**Decisão (2026-06-26):** a conferência por cupom **vira o produto**; o pipeline genérico do v1 é
**removido**. **Reaproveita-se a INFRAESTRUTURA** (não a lógica de domínio):

| Reaproveita (infra) | Remove / aposenta (domínio genérico) |
|---|---|
| OAuth Google + sessão cookie HMAC (`src/api/google.ts`, `sessao.ts`) | `src/pipeline/*` e `src/queue/*` genéricos |
| `SheetsClient` Workers-native + helpers puros `colunas.ts`/`spreadsheet-id.ts` | tipos genéricos `LinhaEntrada`/`LinhaResultado`/`Job` (linha-única) |
| Borda do **OCR Worker** (`src/extract/ocr-worker.ts`) | `montar.ts`/`texto.ts`/`xml.ts` heurísticos (extração passa a ser via IA) |
| Esqueleto Worker + SPA + **`env.DB` + cron** (`worker.ts`, `db.ts`, `processar.ts`, `web/*`) | wiring genérico de `src/api/deps.ts`/`processar.ts` (remontado p/ o domínio) |
| `FileFetcherWorkers` + SSRF (`src/download/`) — vira **fallback** (caminho principal = Drive) | — |
| F1 parsing puro (`validarCnpj/Cpf`, `valorParaCentavos`, `normalizarData`) — **reusado** | — |

> **Sequenciamento da remoção (para o gate ficar verde a cada PR):** **C0 é aditiva** (não remove
> nada de v1). A remoção do v1 genérico acontece **quando substituído**: o domínio puro
> (`pipeline`/`queue` genéricos, `montar/texto/xml`) sai em **C5**; o wiring de API/web genérico em
> **C6**. O **estado final** não tem fluxo genérico. Código removido fica no histórico do git.

---

## 2. Decisões fechadas (2026-06-26) — não "corrigir" por engano

1. **Conferência por cupom é o produto.** v1 genérico removido progressivamente (§1).
2. **IA = GoGroup AI Proxy (gateway OpenAI-compatível)** para **(a)** extrair campos da NF do
   texto do OCR e **(b)** mapear cabeçalho → colunas. **Não** é OpenAI direto: reaproveita o mesmo
   gateway do projeto `godocs-main`. Cliente `fetch` (Workers-friendly) **portado** de
   `godocs-main/src/lib/llm.ts`:
   - `POST {LLM_BASE_URL}/chat/completions`, header `Authorization: Bearer {API_PROXY_TOKEN}`,
     `Content-Type: application/json`; body `{ model, messages, temperature, max_completion_tokens,
     response_format:{type:'json_object'} }` (modo JSON).
   - **Modelo via `LLM_MODEL`** (env; não fixo em `gpt-4.1-mini`). `LLM_API_KEY` = fallback direto
     se `LLM_BASE_URL` ausente. Trata `unsupported_parameter/value` (gpt-5 usa
     `max_completion_tokens`, rejeita `temperature`), timeout + retries de gateway.
   - **Segredos novos:** `LLM_BASE_URL`, `API_PROXY_TOKEN`, `LLM_MODEL`, `LLM_PROVIDER`
     (+ opcionais `LLM_API_KEY`, `LLM_FALLBACK`, `LLM_FALLBACK_MODEL`). Nunca commitar (CLAUDE.md §6).
   - **Prompt de extração = verbatim do n8n** (§5.4). Sem dependência externa nova (é `fetch`).
3. **Mapeamento de colunas = automático, confirma só se incerto.** A IA mapeia e processa; **só
   pausa** pedindo confirmação na UI quando a confiança de uma **coluna crítica** for baixa. O
   **formato** (ordem/nomes) **tende a não mudar** → mapa **cacheado por perfil**, revalidado
   quando o cabeçalho do mês novo diverge.
4. **Perfis por marca, bases fixas, 1 link de formulário por perfil.** O perfil guarda **fixas** a
   base e a config da marca; a cada mês o usuário informa **1 link** do Sheets de "Respostas do
   Formulário", **salvo no banco substituindo o do mês anterior**. Só muda o **mês de busca**
   (`Mês/Ano`). O `spreadsheetId` da base é estável; o do form é o que muda (e por isso é a IA que
   mapeia as colunas dele).
5. **Status em 3 níveis por comparação de valor** (substitui o binário "Validado/Não validado"):
   - **Aprovado** — diferença **exata** (0 centavos).
   - **Parcial** — diferença até **R$ 30,00** (`margemParcialCentavos = 3000`).
   - **Não Aprovado** — diferença **maior** que a margem.
   - Mais os status especiais: **"Sem NF anexada"**, **"Não foi possível ler a NF"**,
     **"CNPJ diferente"** (não passam pela comparação de valor).
6. **Marca/frentes são configuração, não código.** CNPJ do tomador, exclusões de cupom (por
   frente), status bloqueantes, margem parcial e nomes das colunas de saída ficam no **perfil/
   marca** (editáveis), nunca hardcoded como no n8n.
7. **Nomes de coluna de saída padronizados** (liberdade dada pelo usuário; objetivo: claro e
   uniforme). Defaults novos em §4.5 (mapa n8n→novo), **configuráveis por frente**. **Criar a
   coluna** quando o form não a tiver (CLAUDE.md §4 — por cabeçalho, nunca destruir dados).
8. **Unidades internas** seguem o v1: **valores em centavos (inteiro)**, datas **ISO 8601**,
   CNPJ/CPF **só dígitos**. Conversão p/ reais / `DD/MM/YYYY` só na **escrita** da planilha.
9. **Devolutiva = escrita no FORMULÁRIO** + **dashboard na tela**. Não grava na base.
10. **Download das NFs = Google Drive** (escopo `drive.readonly`) — links do form são arquivos do
    Drive (upload do Google Forms), não URLs livres.
11. **Identidade de serviço fixa + sem login na UI (2026-06-26).** _Supera a decisão original
    "OAuth do usuário" do v1 para este produto._
    - O cron lê o Drive e escreve nas planilhas como **`rpa_ia@gocase.com` via refresh token**:
      consentimento **offline uma vez** (escopos `spreadsheets` + `drive.readonly`) → guarda o
      **`GOOGLE_OAUTH_REFRESH_TOKEN`** como secret; o Worker troca por access token a cada tick.
      **NÃO** é OAuth por usuário nem Service Account. A `rpa_ia` já tem **leitura na pasta das NFs
      e escrita nas planilhas** (mesmo acesso do n8n) → **sem re-compartilhar por mês**.
    - **Requisito:** tela de consentimento OAuth em **"Em produção"** (publicada); em modo "Teste"
      o refresh token expira em 7 dias. _(Alternativa possível: Service Account, padrão do
      `godocs-main` — exige compartilhar pasta+planilhas com o e-mail da SA; preterida pelo atrito
      de re-compartilhar o form novo a cada mês.)_
    - **App sem login Google na UI:** o acesso à tela já é gated pelo GoDeploy
      (`visibility: authenticated`, só gocase). Remove a dependência de
      `GOOGLE_OAUTH_CLIENT_ID/SECRET` (hoje **ausentes** nos secrets do app `687dbb00`). A sessão por
      cookie HMAC do v1 fica opcional (controle interno), não para autenticar no Google.

---

## 3. Modelo de domínio (perfis, marcas, frentes)

Persistido em `env.DB` + seed inicial em código (`src/conferencia/perfis/seed.ts`).

```
Marca   { id, nome, cnpjTomador (14 díg.), statusBloqueantes[], margemParcialCentavos }
Perfil  { id, marcaId, nome, base: PlanilhaRef, formSheetUrl? (atualizável/mês),
          frentes: Frente[] }
PlanilhaRef { spreadsheetId, aba }            // aba = nome ou gid (string)
Frente  { tipo: 'INFLUS'|'ASSESSORIA'|'EMBAIXADOR'|'SOMA',
          papelLinkNf?: 'influencer'|'assessoria'|'unica',   // SOMA não tem
          exclusoesCupom[],
          colunasSaida?: ColunasSaida }       // SOMA não tem (escreve nos status de influ+assessoria)
ColunasSaida { status, cnpjTomador, valorNf, retroativo, valorEsperado, valorTotal, dataNf, numeroNf }
```

### Perfis-semente (do n8n) — **um perfil = um formulário** (decisão 4)

| Perfil | Marca | Base (fixa) | Frentes (ordem) | Form (informado/mês) |
|---|---|---|---|---|
| **Gocase · Influencers** | Gocase | `1je8…` / "CONTROLE DE NF - INFLUS" (gid 753018039) | **INFLUS → ASSESSORIA → SOMA** | colado/mês (n8n: `1LcVlg…`) |
| **Gocase · Embaixadores** | Gocase | `1-rvk9…` / "CONTROLE NF" (gid 980327738) | **EMBAIXADOR** | colado/mês (n8n: `1JDG84…`) |
| **Gobeaute · Influencers** | Gobeaute | _esqueleto (TODO)_ | INFLUS → ASSESSORIA → SOMA | colado/mês |
| **Gobeaute · Embaixadores** | Gobeaute | _esqueleto (TODO)_ | EMBAIXADOR | colado/mês |

- Influs/Assessoria/Soma compartilham form e base → **um perfil** (roda as 3 em ordem).
  Embaixadores têm form/base próprios → **outro perfil** (nunca têm assessoria).
- "Rodar a marca" = disparar todos os perfis daquela marca para o mês escolhido.
- **Marca Gocase (semente):** `cnpjTomador = 22165464000190` (DV válido — testado);
  `statusBloqueantes = ['NF Paga','Cash In Pago','Lançado no Pipe','NF Recebida']`;
  `margemParcialCentavos = 3000`.
- **Exclusões por frente (do n8n):** Influs `{LOURDES, ANAJULIAMELO}` · Assessoria `{STEVIEGAS}` ·
  Embaixador `{Danielly, MANDICAROLINNA, CAMISJUNG, VITORIAFONSECAB}`.
- **Gobeaute = TASK FUTURA:** criar apenas o **esqueleto** dos 2 perfis (mesma forma do Gocase),
  sem IDs/CNPJ reais (marcados TODO). Ver §10.

---

## 4. Os 4 fluxos do n8n — regras EXATAS a portar (fonte de verdade)

> Resumo fiel de `fluxos_n8n/*.json`. Replicar 1:1 a semântica; trocar hardcodes por config (§3) e
> gambiarras por orquestração melhor (§7). **Form canônico do Gocase Influencers:** usar o `1LcVlg…`
> (o n8n da Soma aponta outro ID, mas o form é **reenviado pelo usuário a cada mês**, então o ID
> hardcoded não importa — decisão 4).

### 4.1 Entrada e merge (Influs/Assessoria/Embaixador)
- **BASE** filtrada por `Mês/Ano == mesAlvo`. Colunas: `Cupom`, `Valor NF`, `Status`, `Mês/Ano`, `ID`.
- **Filtra base:** `Cupom` não vazio · `Cupom` !contém `#` · `String(Valor NF)` !contém `#`.
  (Embaixador: `Valor NF` que **começa** com `#` → `0`.)
- **FORM** só pendentes: status da frente **vazio** (idempotência). Colunas: cupom, link da NF
  (coluna da frente), `Carimbo de data/hora`.
- **Filtra form:** cupom não vazio · link não vazio · cupom ∉ exclusões da frente.
- **Normaliza cupom:** `toUpperCase().replaceAll(' ','')` (nos dois lados).
- **Valor base** → centavos (inteiro).
- **Merge por cupom** (`enrichInput2`): cada linha do FORM enriquecida com a BASE do mesmo cupom;
  descarta form sem base. **Agrupa por cupom** (1ª resposta).

### 4.2 Download + OCR + extração
- Link do Drive `open?id=`→`file/d/` → baixar do **Drive** (OAuth). Sem link → **"Sem NF anexada"**.
- PDF → **OCR Worker** (`POST application/pdf` + Bearer, json, 60s) → texto.
- Texto → **AI Proxy** (modo JSON, prompt §5.4) → `{CNPJ1, CNPJ2, Valor, data_emissao, num_nota}`.

### 4.3 Validação inicial (pura) — com status em 3 níveis
Sendo `CNPJ_TOMADOR` o da marca e `classificar(diff)`: `diff===0 → APROVADO` ·
`diff ≤ margemParcialCentavos → PARCIAL` · `senão → NAO_APROVADO`:
1. Sem URL → **SEM_NF**.
2. IA sem `CNPJ1`/`CNPJ2`/`Valor` → **NAO_LEGIVEL**.
3. `cnpj1/cnpj2 = somenteDigitos(...)`; se **nenhum** == marca → **CNPJ_DIFERENTE** (guarda valor/
   num/data). O que casar = `cnpjTomador`. _(Reforço: `validarCnpj` (F1) como sanity-check.)_
4. `valorNf` (IA, via `valorParaCentavos`) vs `valorBase`: `status = classificar(|valorNf−base|)`.
   Se **APROVADO** → fim (`Retroativo=0`, `valorEsperado=base`, `valorTotal=base`). Senão
   `precisaRetroativo = true` (guarda a classificação inicial como fallback).

### 4.4 Retroativo (Influs/Assessoria/Embaixador) — pura
Busca **todo o histórico do cupom** na base (1 leitura, indexada em memória — §7), remove
duplicatas `(Mês/Ano, Valor NF)`, considera **só meses anteriores** ao `mesAlvo`
(`mesParaNumero('MM/YYYY')=ano*12+mes`), **ordena do mais recente p/ o mais antigo** e **acumula**
`acumulado = base + Σ(anteriores)` parando quando bater um `Status ∈ statusBloqueantes`. Rastreia o
**menor `|acumulado − valorNf|`** alcançado; `status = classificar(menorDiff)` (generaliza o n8n,
que só aceitava exato). Saída: `Status`, `Retroativo` (Σ meses), `valorEsperado` (acumulado),
`valorTotal = base + Retroativo`, `mesesRetroativos`. _(Caso: 1 NF cobre vários meses.)_

### 4.5 Saída por frente (escreve no FORM, upsert por cupom) — **nomes padronizados**
Default novo (configurável por frente). Fixa o typo "Infu", unifica separadores/acentos, e usa
`Valor Esperado` (era `ValorPlanilha`). **Criar a coluna se faltar.**

| Papel | Influs (default novo) | n8n (origem) |
|---|---|---|
| status | `Status (influ)` | `Status (influ)` |
| cnpjTomador | `CNPJ Tomador (influ)` | `CNPJ_Tomador_Influ` |
| valorNf | `Valor NF (influ)` | `ValorNF_Influ` |
| retroativo | `Retroativo (influ)` | `Retroativo_Infu` (typo) |
| valorEsperado | `Valor Esperado` | `ValorPlanilha` |
| valorTotal | `Valor Total (influ)` | `ValorTotal_Influ` |
| dataNf | `Data NF (influ)` | `DataNF_Influ` |
| numeroNf | `Número NF (influ)` | `NumeroNF_Influ` |

- **Assessoria:** mesmo esquema com sufixo `(assessoria)`. **Embaixador:** mesmo esquema **sem
  sufixo** (form próprio, sem assessoria): `Status`, `CNPJ Tomador`, `Valor NF`, `Retroativo`,
  `Valor Esperado`, `Valor Total`, `Data NF`, `Número NF`.
- Campo ausente → `""` (idempotência). Limites do n8n (45/15/100) **viram lote por cron** (§7).

### 4.6 Soma (reconciliação influ+assessoria) — só no perfil Influencers, após Influs/Assessoria
- Cupons com **influ E assessoria preenchidos** e **ambos não-Aprovado** (descarta "só influ").
- `Soma = valorNf(influ) + valorNf(assessoria)`; `status = classificar(|Soma − base|)`. Se melhora,
  grava **`Status (influ)` e `Status (assessoria)`** com o novo status. _(Caso: comissão dividida
  em 2 NFs — influencer + agência.)_

---

## 5. Arquitetura por camadas (reuso da infra do v1)

Tudo sob `src/conferencia/`, com I/O nas bordas atrás de interface (testável com fakes).

1. **`perfis/`** — modelo §3, seed Gocase + esqueleto Gobeaute, repo (memória agora; `env.DB` em C5).
2. **`mapeamento/`** — IA de colunas (§6) atrás de `MapeadorColunas`.
3. **`dados/`** — ler base+form (`SheetsClient`), normalizar, filtrar, **merge por cupom**, indexar histórico.
4. **`drive/`** — download de NF do Drive como **`rpa_ia` (refresh token, decisão 11)** + escopo
   `drive.readonly`; `FileFetcherWorkers` = fallback p/ link não-Drive.
5. **`extracao/`** — OCR Worker (reusa) → AI Proxy (prompt §5.4) → `CamposNf`. Cache por hash.
6. **`validacao/`** — **puras**: `classificarStatus`, `validarNfInicial`, `validarComRetroativo`,
   `mesParaNumero`, `reconciliarSoma`. Reusa F1. **Coração testado** (fatia C1).
7. **`pipeline/`** — orquestra por frente e por perfil (Influs→Assessoria→Soma); falha isolada;
   idempotência por status; lote por cron sobre `env.DB`.
8. **`src/api/` + `src/web/`** — reusa o esqueleto: rotas + SPA; job = `(perfil, mês)`;
   `/api/mapeamento` propõe/confirma colunas; dashboard.

### 5.4 Prompt do AI Proxy (verbatim do n8n — manter paridade)
- **system:** `Você vai receber um texto que é uma Nota Fiscal. Extraia:\n- CNPJ do Emissor/
  Prestador\n- Valor Líquido da nota (número float, ex: 100.00, sem R$)\n- CNPJ do Tomador do
  Serviço\n- Data de emissão (formato DD/MM/YYYY)\n- Número da nota fiscal\n\nRetorne JSON:\n{\n
  "CNPJ1": "CNPJ DO EMISSOR",\n  "Valor": 100.00 (sempre com duas casas decimais),\n  "CNPJ2":
  "CNPJ DO TOMADOR",\n  "data_emissao": "DD/MM/YYYY",\n  "num_nota": "NÚMERO"\n}`
- **user:** o `text` do OCR Worker. Modo JSON (`response_format:{type:'json_object'}`).

---

## 6. IA de mapeamento de colunas (detalhe)
- **Papéis de entrada:** `cupom`, `linkNf_influencer`, `linkNf_assessoria`, `linkNf_unica`,
  `carimbo`. **Papéis de saída:** as 8 colunas (§4.5) por frente.
- **Entrada p/ IA:** cabeçalhos + 2–3 valores de exemplo por coluna. **Saída:** `{ papel →
  { coluna, confianca 0..1 } }` (modo JSON).
- **Política (decisão 3):** processa automático quando `cupom`, link da NF e a coluna de `status`
  têm confiança ≥ limiar; **só pausa** abaixo disso. Mapa **cacheado no perfil**; revalida no mês
  novo. Colunas de saída ausentes → **criar** (§4.5). Validações/regex por papel reusam F1.

> **Onde aterrissou (C2 — `src/conferencia/mapeamento/`):** `MapeadorColunasIa` implementa o
> contrato `MapeadorColunas` sobre o `ClienteLlm` (interface da C0; impl real do AI Proxy é a C3 —
> aqui usamos um fake nos testes). Peças puras: `prompt.ts` (mensagens system+user, modo JSON),
> `parse.ts` (parse tolerante: lê JSON cercado por texto, grampeia confiança a [0,1], casa cabeçalho
> case-insensitive→canônico, descarta coluna inventada/papel não pedido), `heuristicas.ts`
> (coerência papel↔coluna reusando `normalizarData` da F1 + regex de URL/cupom), `politica.ts`
> (`avaliarMapeamento` → `precisaConfirmar`) e `resolver.ts` (cache por perfil + revalidação).
> **Limiar padrão `0.8`** (`LIMIAR_CONFIANCA_PADRAO`, sobrescrevível). **Refino da política:** críticos
> de **entrada** (cupom/link) ausentes **travam** (campo `faltando`); `status` é **saída** — se faltar
> é **criada** no nome padrão (`saidaACriar`, não trava), só pausa se existir de forma ambígua. O
> `cacheValido` também só exige os críticos de **entrada** (senão re-mapearia todo mês à toa).

---

## 7. Otimizações vs n8n ("melhor, mais rápido, otimizado")
| n8n | v2 |
|---|---|
| Schedule 1–6 min + `Wait` 2–3s + `Limit` 15/45/100 | **Job + cron**, lote/tick, **concorrência limitada**, retomável; sem `Wait`/teto fixo. |
| `Busca Histórico Cupom` por cupom | **1 leitura** da base, **indexada por cupom** em memória. |
| `appendOrUpdate` por linha | **`values.batchUpdate`** em lote. |
| Re-OCR/re-IA do mesmo arquivo | **cache por hash** (SHA-256). |
| Colunas/CNPJ/mês/exclusões hardcoded (e dessincronizados: influs `05/2026`, soma `03/2026`) | **mapa IA + config por perfil**; mês escolhido no run. |
| Sem DV/erro estruturado | **`validarCnpj` (F1)** + confiança; baixa confiança não grava lixo. |

---

## 8. Segurança e segredos
- **Segredos do AI Proxy (cadastrados 2026-06-26 no app `687dbb00`):** `LLM_BASE_URL`
  (`https://ai-proxy.gogroupbr.com/v1`), `API_PROXY_TOKEN`, `LLM_MODEL` (`gpt-5.4-mini`),
  `LLM_PROVIDER` (`openai`). **Já existe:** `OCR_WORKER_TOKEN`/`OCR_WORKER_URL` (o token estava
  **exposto** no JSON do n8n — rotacionar se possível). Tudo via `setAppSecret`; placeholder no
  `.env.example`. _(O `API_PROXY_TOKEN` foi colado em chat — convém rotacionar.)_
- **Identidade de serviço (decisão 11):** segredo **`GOOGLE_OAUTH_REFRESH_TOKEN`** da `rpa_ia`
  (escopos `spreadsheets` + `drive.readonly`), obtido por consentimento offline 1x com a tela de
  consentimento **publicada**. O Worker troca o refresh por access token a cada tick (endpoint
  `oauth2/token`). `GOOGLE_OAUTH_CLIENT_ID/SECRET` passam a ser do **app OAuth da rpa_ia** (para o
  refresh), **não** para login de usuário.
- **Sem login de usuário na UI:** acesso gated pelo GoDeploy (`authenticated`).
- Não logar conteúdo de NF/PII. Tokens no `env.DB`/secrets, nunca commitados.
- **`fluxos_n8n/`** contém o token do OCR exposto — **não commitar** sem sanitizar (manter
  local/gitignore).

---

## 9. Roadmap de fatias v2 (uma por worktree/branch/PR — CLAUDE.md §7)

| # | Fatia | Escopo | Depende | Estado |
|---|-------|--------|---------|--------|
| **C0** | **Fundação v2 (aditiva)** | tipos do domínio, interfaces de camada, **seed Gocase + esqueleto Gobeaute**, repo em memória, **DDL `env.DB`** (aditivo, não toca v1). | — | ✅ PR #13 mergeada |
| **C1** | **Validação + Retroativo + Soma (puro)** | `classificarStatus` (3 níveis), `validarNfInicial`, `validarComRetroativo`, `reconciliarSoma`, `mesParaNumero`; reusa F1. **Muitos testes.** | C0 | ✅ PR #15 mergeada — `src/conferencia/validacao/` + `test/conferencia-validacao.test.ts` |
| **C2** | **Mapeador de colunas (AI Proxy)** | header→papéis + confiança + cache + "perguntar só se incerto". Borda AI Proxy (fake nos testes). | C0 | ✅ PR #14 mergeada — `src/conferencia/mapeamento/` |
| **C3** | **Extração de campos (OCR + AI Proxy)** | reusa `ocr-worker.ts`; cliente AI Proxy (port de `llm.ts`); prompt §5.4 → `CamposNf`; cache por hash. | C0 | ⬜ |
| **C4** | **Drive + identidade de serviço** | credencial **`rpa_ia` (refresh token → access token)** com escopos `spreadsheets`+`drive.readonly`; `open?id=`→fileId; baixar bytes; fallback SSRF. | C0 | ⬜ |
| **C5** | **Pipeline + job/cron + remoção do domínio v1** | ler base+form, normalizar/filtrar/merge, processar cupom (C4→C3→C1), depois Soma; idempotência/lote. **Remove `pipeline`/`queue`/`montar/texto/xml` genéricos.** | C0 (C1–C4 via interface) | ⬜ |
| **C6** | **API + Web + flip do produto** | perfis (ver/editar), iniciar conferência (marca + mês + link do form), confirmação de mapeamento, dashboard. **Remove o wiring v1 genérico e o login Google da UI** (acesso via GoDeploy `authenticated`). | C0, C5 | ⬜ |

**Ordem:** C0 → (C1, C2, C3, C4 em paralelo) → C5 → C6.
**Gate por fatia:** `npm run typecheck` 0 erros · `npm test` verde · `npm run build` ok.

---

## 10. Pendências / dados a obter
- [ ] **Gobeaute (TASK FUTURA — só esqueleto agora):** IDs/abas das bases, CNPJ do tomador,
      exclusões; confirmar se o "formato" das colunas espelha o Gocase. Registrado em §3 e no seed
      (`src/conferencia/perfis/seed.ts`, perfis marcados `TODO`).
- [x] **Segredos do AI Proxy** (`LLM_BASE_URL`/`API_PROXY_TOKEN`/`LLM_MODEL`/`LLM_PROVIDER`)
      cadastrados no app `687dbb00` em 2026-06-26 (via `setAppSecret`).
- [ ] **Identidade de serviço `rpa_ia` (decisão 11):** publicar a tela de consentimento OAuth
      ("Em produção"); fazer o consentimento **offline 1x** com `rpa_ia@gocase.com` (escopos
      `spreadsheets` + `drive.readonly`); cadastrar `GOOGLE_OAUTH_REFRESH_TOKEN` (+ `CLIENT_ID`/
      `CLIENT_SECRET` do app OAuth da rpa_ia) como secrets. Confirmar que a `rpa_ia` tem leitura na
      pasta das NFs e escrita nas planilhas-base e de formulário.
- [ ] Confirmar comportamento de **criar coluna de saída** na UI (aviso ao usuário?).

---

## 11. Como retomar numa nova sessão (runbook)
1. **Ler este doc + memória** `conferencia-v2-spec-junho-2026` (e, p/ contexto do v1 substituído,
   `fatias-v1-spec-junho-2026`).
2. **Sincronizar:** na `main`, `git fetch origin` + `git pull --ff-only origin main`.
3. **Cada fatia em worktree próprio** (CLAUDE.md §7), em `../analise-notas-fiscais-worktrees/`:
   `git worktree add ../analise-notas-fiscais-worktrees/<fatia> -b feat/<fatia> main` + junction do
   `node_modules` (via PowerShell `New-Item -ItemType Junction`).
4. **Gate antes de "pronto":** typecheck 0 erros · testes verdes · build ok.
5. **Obrigatório (CLAUDE.md):** PT-BR com acento · atualizar **este spec** (status + "onde
   aterrissou") e o **CLAUDE.md** (§10/§11) **no mesmo PR** · `git pull` antes do PR · um chat = uma fatia.
6. **Fonte de verdade da regra de negócio:** §4 deste doc (extraído de `fluxos_n8n/*.json`).
