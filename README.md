# Análise de Notas Fiscais a partir de Planilhas

Plataforma web onde o usuário informa o **link de uma planilha (Google Sheets)** contendo
links/identificadores de notas fiscais. O sistema:

1. **Lê a planilha** via Google Sheets API.
2. **Baixa as notas fiscais em PDF** a partir dos links de cada linha.
3. **Extrai os dados com OCR** (e parsing de texto/XML quando disponível).
4. **Escreve o resultado de volta na planilha**, registro por registro (uma linha por nota).

> ⚠️ Projeto em fase de preparação. A arquitetura detalhada será definida no planejamento.
> Stack base escolhida: **Node.js + TypeScript**, integração com **Google Sheets**.

## Visão do fluxo

```
Usuário cola link da planilha
        │
        ▼
  [API web]  ──cria──►  Job de processamento
        │                      │
        │                ┌─────┴───────────────────────────┐
        │                ▼                                  │
  Lê linhas da      Para cada linha:                        │
  planilha          baixa PDF → OCR → extrai campos         │
                         │                                  │
                         ▼                                  │
                Escreve resultado de volta ◄────────────────┘
                na planilha (status + campos)
```

## Status

| Etapa                          | Estado        |
| ------------------------------ | ------------- |
| Repositório / terreno inicial  | ✅ Feito       |
| Planejamento de arquitetura    | ⏳ Próximo     |
| Integração Google Sheets       | ⬜ A fazer     |
| Download de PDFs               | ⬜ A fazer     |
| Pipeline de OCR                | ⬜ A fazer     |
| Escrita de resultados          | ⬜ A fazer     |
| Frontend                       | ⬜ A fazer     |

## Começando (após o planejamento)

```bash
cp .env.example .env   # preencha as credenciais
npm install
npm run dev
```

Veja **[CLAUDE.md](./CLAUDE.md)** para as convenções e diretrizes de desenvolvimento.
