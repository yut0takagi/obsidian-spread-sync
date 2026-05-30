export interface CacheEntry {
  value: unknown;
  fetchedAt: number;
  fileModifiedTime: string | null;
}

export interface CacheStoreOpts {
  persist: (snapshot: Record<string, CacheEntry>) => void;
  maxEntries?: number;
  persistDebounceMs?: number;
}

export class CacheStore {
  private map = new Map<string, CacheEntry>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxEntries: number;
  private readonly debounceMs: number;
  private readonly persistFn: (snapshot: Record<string, CacheEntry>) => void;

  constructor(opts: CacheStoreOpts) {
    this.persistFn = opts.persist;
    this.maxEntries = opts.maxEntries ?? 1000;
    this.debounceMs = opts.persistDebounceMs ?? 500;
  }

  load(snapshot: Record<string, CacheEntry>): void {
    this.map.clear();
    for (const [k, v] of Object.entries(snapshot)) this.map.set(k, v);
  }

  get(key: string): CacheEntry | null {
    const e = this.map.get(key);
    if (!e) return null;
    // bump recency
    this.map.delete(key);
    this.map.set(key, e);
    return e;
  }

  set(key: string, entry: CacheEntry): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    this.schedulePersist();
  }

  invalidate(key: string): void {
    if (this.map.delete(key)) this.schedulePersist();
  }

  invalidatePrefix(prefix: string): void {
    let changed = false;
    for (const k of Array.from(this.map.keys())) {
      if (k.startsWith(prefix)) {
        this.map.delete(k);
        changed = true;
      }
    }
    if (changed) this.schedulePersist();
  }

  isStale(key: string, ttlMs: number): boolean {
    const e = this.map.get(key);
    if (!e) return true;
    return Date.now() - e.fetchedAt > ttlMs;
  }

  snapshot(): Record<string, CacheEntry> {
    const out: Record<string, CacheEntry> = {};
    for (const [k, v] of this.map) out[k] = v;
    return out;
  }

  clear(): void {
    this.map.clear();
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persistFn(this.snapshot());
    }, this.debounceMs);
  }
}
