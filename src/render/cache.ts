import type { Rendered } from '../lib/types';
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;
/** Bounded LRU of parsed markup, without file handles, assets, or trust decisions. */
export class RenderCache {
  private entries = new Map<string, { result: Rendered; bytes: number }>();
  private bytes = 0;
  get(key: string): Rendered | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { ...entry.result, elapsed: 0 };
  }
  set(key: string, result: Rendered) {
    const bytes = (key.length + result.html.length + JSON.stringify(result.headings).length) * 2;
    if (bytes > MAX_CACHE_BYTES) return;
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { result, bytes });
    this.bytes += bytes;
    while (this.bytes > MAX_CACHE_BYTES || this.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
}
