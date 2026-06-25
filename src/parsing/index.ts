/**
 * Contratos de parsing/validação — funções **puras**, sem I/O (CLAUDE.md §7).
 * Implementação + testes: fatia F1 (é a parte com mais regras e casos de borda).
 *
 * Estes são os tipos das funções esperadas. A fatia F1 implementa e exporta as
 * funções concretas a partir deste módulo.
 */

/** Valida um CNPJ pelos dígitos verificadores. Recebe com ou sem máscara. */
export type ValidarCnpj = (cnpj: string) => boolean;

/** Valida um CPF pelos dígitos verificadores. */
export type ValidarCpf = (cpf: string) => boolean;

/** Remove tudo que não for dígito. */
export type SomenteDigitos = (texto: string) => string;

/**
 * Converte um valor monetário em texto (`"R$ 1.234,56"`, `"1234,56"`, `"1234.56"`)
 * para inteiro em **centavos**. Retorna `null` se não for um valor plausível.
 */
export type ValorParaCentavos = (texto: string) => number | null;

/**
 * Normaliza uma data (`"25/06/2026"`, `"2026-06-25"`, ISO com hora) para
 * `YYYY-MM-DD`. Retorna `null` se a data for inválida ou implausível.
 */
export type NormalizarData = (texto: string) => string | null;
