export type CollectionPage<T> = { items: T[]; page: number; hasNext: boolean; totalItems: number; totalPages: number };

/** Offset windows may overlap; preserve order while using the latest value for an ID. */
export function projectCollection<T>(
  pages: CollectionPage<T>[] | undefined,
  feed: boolean,
  identify: (item: T) => string,
) {
  const last = pages?.at(-1);
  if (!last || !pages) return { items: [] as T[], meta: undefined };
  const items = feed
    ? [...new Map(pages.flatMap((page) => page.items).map((item) => [identify(item), item])).values()]
    : pages[0].items;
  return {
    items,
    meta: {
      page: last.page,
      firstPage: pages[0].page,
      hasNext: last.hasNext,
      totalItems: last.totalItems,
      totalPages: last.totalPages,
    },
  };
}
