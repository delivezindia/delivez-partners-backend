/** Prisma paging arguments: `batch` rows at a time in id order, starting after `cursor`. */
export type Page = { take: number; orderBy: { id: 'asc' }; cursor?: { id: string }; skip?: number };

// Every row of a query, a batch at a time: for jobs that must see all matching rows however many there are
// (a plain `take` would silently drop the rest, and the same rows would come back on every run).
export async function everyRow<T extends { id: string }>(page: (p: Page) => Promise<T[]>, batch = 500) {
  const rows: T[] = [];
  for (let cursor: string | undefined; ; ) {
    const got = await page({ take: batch, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    rows.push(...got);
    if (got.length < batch) return rows;
    cursor = got[got.length - 1].id;
  }
}
