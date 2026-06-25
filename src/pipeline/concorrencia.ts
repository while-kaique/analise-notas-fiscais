/**
 * Pool de concorrência limitada para processar itens em paralelo sem estourar
 * limites de rede/quota (CLAUDE.md §6: concorrência máxima de downloads).
 *
 * Preserva a ordem: `resultados[i]` corresponde a `itens[i]`. Não captura erros —
 * cabe ao `fn` não lançar (no pipeline, `processarLinha` já garante isso).
 */
export async function processarComConcorrencia<T, R>(
  itens: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;

  async function trabalhador(): Promise<void> {
    for (;;) {
      const indice = proximo++;
      if (indice >= itens.length) return;
      const item = itens[indice]!; // seguro: indice < itens.length
      resultados[indice] = await fn(item, indice);
    }
  }

  const n = Math.max(1, Math.min(limite, itens.length));
  await Promise.all(Array.from({ length: n }, () => trabalhador()));
  return resultados;
}

/** Timestamp em ISO 8601 (centraliza para facilitar testes futuros). */
export function agora(): string {
  return new Date().toISOString();
}
