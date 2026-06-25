# CLAUDE.md — Plataforma de Análise de Notas Fiscais

Instruções para desenvolvimento neste repositório. Leia antes de codar.

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
- **Integração de planilha:** Google Sheets API (`googleapis`). Service Account é o caminho
  padrão; a planilha-alvo precisa ser compartilhada com o e-mail da service account.
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

## 10. Decisões (log)

> Registre aqui decisões de arquitetura/stack com data e motivo. Ex.:
- **2026-06-25** — Stack base definida: Node.js + TypeScript, Google Sheets como fonte de
  planilha, Tesseract como OCR inicial (atrás de interface trocável). Pipeline por job
  assíncrono. _(planejamento detalhado pendente)_
