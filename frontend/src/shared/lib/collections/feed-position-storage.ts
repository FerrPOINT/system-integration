import { isPageIndex } from '../pagination/page-index.ts';

export const FEED_PAGE_LIMIT = 5;
const prefix = 'system-integration.feed-position.';
const positionLimit = 32;

export type FeedPosition = { page: number; index: number; id?: string; offset: number; scrollY: number };
export type PositionIssue = 'invalid' | 'unavailable';

export const positionKey = (owner: string, route: string, query: string) =>
  prefix + JSON.stringify([owner, route, query]);

export function readPosition(
  key: string,
  size: number,
  supplied?: Storage,
): { position?: FeedPosition; issue?: PositionIssue } {
  try {
    const value = (supplied ?? window.sessionStorage).getItem(key);
    if (!value) return {};
    const record = JSON.parse(value);
    const p = record?.position;
    if (
      record?.version !== 1 ||
      !p ||
      !isPageIndex(p.page) ||
      !Number.isInteger(p.index) ||
      p.index < 0 ||
      p.index >= size ||
      (p.id !== undefined && (typeof p.id !== 'string' || !p.id)) ||
      !Number.isFinite(p.offset) ||
      !Number.isFinite(p.scrollY) ||
      p.scrollY < 0
    )
      return { issue: 'invalid' };
    return { position: { page: p.page, index: p.index, id: p.id, offset: p.offset, scrollY: p.scrollY } };
  } catch (error) {
    return { issue: error instanceof SyntaxError ? 'invalid' : 'unavailable' };
  }
}

export function writePosition(key: string, position: FeedPosition, supplied?: Storage): PositionIssue | undefined {
  try {
    const storage = supplied ?? window.sessionStorage;
    // Scanning is needed only for a newly visited collection, not on every scroll.
    if (storage.getItem(key) === null) {
      const entries: { key: string; time: number }[] = [];
      for (let index = 0; index < storage.length; index++) {
        const candidate = storage.key(index);
        if (candidate?.startsWith(prefix)) {
          let time = 0;
          try {
            time = JSON.parse(storage.getItem(candidate) || '{}').updatedAt || 0;
          } catch {
            /* Invalid UI metadata is expendable. */
          }
          entries.push({ key: candidate, time });
        }
      }
      entries.sort((a, b) => a.time - b.time);
      while (entries.length >= positionLimit) storage.removeItem(entries.shift()!.key);
    }
    storage.setItem(key, JSON.stringify({ version: 1, updatedAt: Date.now(), position }));
  } catch {
    return 'unavailable';
  }
}

export function clearFeedPositions(supplied?: Storage) {
  try {
    const storage = supplied ?? window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    /* An inaccessible browser store cannot expose a previous identity's position. */
  }
}
