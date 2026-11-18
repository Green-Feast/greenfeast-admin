import "server-only";

// PostgREST returns at most 1,000 rows per request (the project's max_rows),
// so month-end lists page through with .range() until a short page.
// `page(from, to)` builds the query for one page.
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
  cap = 50_000
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}
