import { describe, it, expect } from 'vitest';
import {
  somenteDigitos,
  validarCnpj,
  validarCpf,
  valorParaCentavos,
  normalizarData,
} from '../src/parsing/index.js';

describe('somenteDigitos', () => {
  it('remove máscara e símbolos, mantendo só dígitos', () => {
    expect(somenteDigitos('11.222.333/0001-81')).toBe('11222333000181');
    expect(somenteDigitos('111.444.777-35')).toBe('11144477735');
    expect(somenteDigitos('R$ 1.234,56')).toBe('123456');
  });

  it('retorna string vazia quando não há dígitos', () => {
    expect(somenteDigitos('abc')).toBe('');
    expect(somenteDigitos('')).toBe('');
  });
});

describe('validarCnpj', () => {
  it('aceita CNPJ válido com e sem máscara', () => {
    expect(validarCnpj('11.222.333/0001-81')).toBe(true);
    expect(validarCnpj('11222333000181')).toBe(true);
  });

  it('rejeita dígito verificador incorreto', () => {
    expect(validarCnpj('11222333000182')).toBe(false);
    expect(validarCnpj('11.222.333/0001-80')).toBe(false);
  });

  it('rejeita comprimento errado', () => {
    expect(validarCnpj('1122233300018')).toBe(false); // 13 dígitos
    expect(validarCnpj('112223330001811')).toBe(false); // 15 dígitos
    expect(validarCnpj('')).toBe(false);
  });

  it('rejeita sequências de dígito repetido', () => {
    expect(validarCnpj('00000000000000')).toBe(false);
    expect(validarCnpj('11111111111111')).toBe(false);
  });
});

describe('validarCpf', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(validarCpf('111.444.777-35')).toBe(true);
    expect(validarCpf('11144477735')).toBe(true);
    expect(validarCpf('529.982.247-25')).toBe(true);
  });

  it('rejeita dígito verificador incorreto', () => {
    expect(validarCpf('11144477736')).toBe(false);
    expect(validarCpf('111.444.777-30')).toBe(false);
  });

  it('rejeita comprimento errado', () => {
    expect(validarCpf('1114447773')).toBe(false); // 10 dígitos
    expect(validarCpf('111444777355')).toBe(false); // 12 dígitos
    expect(validarCpf('')).toBe(false);
  });

  it('rejeita sequências de dígito repetido', () => {
    expect(validarCpf('00000000000')).toBe(false);
    expect(validarCpf('99999999999')).toBe(false);
  });
});

describe('valorParaCentavos', () => {
  it('converte formato brasileiro com R$', () => {
    expect(valorParaCentavos('R$ 1.234,56')).toBe(123456);
    expect(valorParaCentavos('R$1.234,56')).toBe(123456);
    expect(valorParaCentavos('1.234.567,89')).toBe(123456789);
  });

  it('converte vírgula como decimal', () => {
    expect(valorParaCentavos('1234,56')).toBe(123456);
    expect(valorParaCentavos('12,5')).toBe(1250);
    expect(valorParaCentavos('0,99')).toBe(99);
  });

  it('converte ponto como decimal (formato US/sem milhar)', () => {
    expect(valorParaCentavos('1234.56')).toBe(123456);
    expect(valorParaCentavos('0.50')).toBe(50);
  });

  it('trata os dois separadores escolhendo o último como decimal', () => {
    expect(valorParaCentavos('1.234,56')).toBe(123456); // BR
    expect(valorParaCentavos('1,234.56')).toBe(123456); // US
  });

  it('trata separador único de 3 casas como milhar', () => {
    expect(valorParaCentavos('1.234')).toBe(123400);
    expect(valorParaCentavos('1,234')).toBe(123400);
    expect(valorParaCentavos('1.234.567')).toBe(123456700);
  });

  it('converte inteiro sem separador', () => {
    expect(valorParaCentavos('1234')).toBe(123400);
    expect(valorParaCentavos('0')).toBe(0);
  });

  it('arredonda casas decimais extras para centavos', () => {
    // Com os dois separadores não há ambiguidade: o último é o decimal.
    expect(valorParaCentavos('1.234,567')).toBe(123457); // 1234,567 → 1234,57
    expect(valorParaCentavos('1.234,564')).toBe(123456); // 1234,564 → 1234,56
    expect(valorParaCentavos('12,5')).toBe(1250); // completa a casa faltante
  });

  it('lida com valor negativo (sinal e parênteses contábeis)', () => {
    expect(valorParaCentavos('-1.234,56')).toBe(-123456);
    expect(valorParaCentavos('(1.234,56)')).toBe(-123456);
  });

  it('retorna null quando não há valor numérico', () => {
    expect(valorParaCentavos('')).toBeNull();
    expect(valorParaCentavos('R$')).toBeNull();
    expect(valorParaCentavos('abc')).toBeNull();
    expect(valorParaCentavos('   ')).toBeNull();
  });
});

describe('normalizarData', () => {
  it('normaliza formato brasileiro DD/MM/YYYY', () => {
    expect(normalizarData('25/06/2026')).toBe('2026-06-25');
    expect(normalizarData('01/01/2025')).toBe('2025-01-01');
    expect(normalizarData('5/6/2026')).toBe('2026-06-05');
  });

  it('aceita separadores - e . no formato brasileiro', () => {
    expect(normalizarData('25-06-2026')).toBe('2026-06-25');
    expect(normalizarData('25.06.2026')).toBe('2026-06-25');
  });

  it('aceita ano de 2 dígitos (século 2000)', () => {
    expect(normalizarData('25/06/26')).toBe('2026-06-25');
  });

  it('passa por ISO e ISO com hora', () => {
    expect(normalizarData('2026-06-25')).toBe('2026-06-25');
    expect(normalizarData('2026-06-25T10:30:00Z')).toBe('2026-06-25');
    expect(normalizarData('2026-06-25 10:30')).toBe('2026-06-25');
    expect(normalizarData('2026/06/25')).toBe('2026-06-25');
  });

  it('aceita data limite de fevereiro em ano bissexto', () => {
    expect(normalizarData('29/02/2024')).toBe('2024-02-29');
  });

  it('rejeita 29/02 em ano não bissexto', () => {
    expect(normalizarData('29/02/2025')).toBeNull();
  });

  it('rejeita dia/mês fora do calendário', () => {
    expect(normalizarData('31/04/2026')).toBeNull(); // abril tem 30
    expect(normalizarData('32/01/2026')).toBeNull();
    expect(normalizarData('25/13/2026')).toBeNull();
    expect(normalizarData('00/06/2026')).toBeNull();
  });

  it('rejeita anos fora da janela plausível', () => {
    expect(normalizarData('25/06/1999')).toBeNull();
    expect(normalizarData('1999-06-25')).toBeNull();
    expect(normalizarData('25/06/2101')).toBeNull();
  });

  it('rejeita texto que não é data', () => {
    expect(normalizarData('')).toBeNull();
    expect(normalizarData('abc')).toBeNull();
    expect(normalizarData('25/06')).toBeNull();
  });
});
