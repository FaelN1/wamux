/**
 * Executa `fn` sobre `items` com no máximo `concurrency` chamadas em paralelo
 * (worker pool simples, sem dependência externa). Usado quando enriquecer
 * uma listagem exige 1 chamada extra por item (ex.: foto de perfil de cada
 * grupo/comunidade) — evita tanto o custo serial (N × latência) quanto uma
 * rajada de N chamadas simultâneas na engine (risco de rate-limit/anti-ban).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
