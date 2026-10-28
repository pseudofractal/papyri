import type { Entry, Source } from './types';
const pending = new WeakMap<Source, Map<string, Promise<Entry[]>>>();
/** Coalesce slow listings so polling cannot accumulate filesystem work for the same directory. */
export function listDirectory(source: Source, path: string): Promise<Entry[]> {
  let listings = pending.get(source);
  if (!listings) {
    listings = new Map();
    pending.set(source, listings);
  }
  const existing = listings.get(path);
  if (existing) return existing;
  const request = source.list(path).finally(() => listings!.delete(path));
  listings.set(path, request);
  return request;
}
