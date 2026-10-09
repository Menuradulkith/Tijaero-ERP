/**
 * Fetch every page of a server-paged list (used by the grids' Export, which
 * must cover all rows matching the filters, not just the page on screen).
 * Stops at `maxRows` so a huge table can't lock up the browser.
 */
export async function fetchAllPages<T>(
  getPage: (page: number) => Promise<{ items: T[]; pages: number }>,
  maxRows = 50000,
  pageSize = 200
): Promise<T[]> {
  const out: T[] = [];
  let page = 0;
  let pages = 1;
  while (page < pages && out.length < maxRows && page * pageSize < maxRows) {
    const res = await getPage(page);
    out.push(...res.items);
    pages = res.pages;
    page += 1;
  }
  return out;
}
