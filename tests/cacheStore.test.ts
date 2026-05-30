import { describe, it, expect, vi } from "vitest";
import { CacheStore, CacheEntry } from "../src/storage/CacheStore";

function makeEntry(value: unknown, fetchedAt = Date.now()): CacheEntry {
  return { value, fetchedAt, fileModifiedTime: null };
}

describe("CacheStore", () => {
  it("get returns null for missing key", () => {
    const c = new CacheStore({ persist: vi.fn() });
    expect(c.get("k")).toBeNull();
  });

  it("set then get returns same entry", () => {
    const c = new CacheStore({ persist: vi.fn() });
    const e = makeEntry(42);
    c.set("k", e);
    expect(c.get("k")).toEqual(e);
  });

  it("invalidate removes entry", () => {
    const c = new CacheStore({ persist: vi.fn() });
    c.set("k", makeEntry(1));
    c.invalidate("k");
    expect(c.get("k")).toBeNull();
  });

  it("invalidatePrefix removes all keys starting with prefix", () => {
    const c = new CacheStore({ persist: vi.fn() });
    c.set("1ABC#Sheet1#B3", makeEntry(1));
    c.set("1ABC#Sheet1#C4", makeEntry(2));
    c.set("XYZ#Sheet1#A1", makeEntry(3));
    c.invalidatePrefix("1ABC#");
    expect(c.get("1ABC#Sheet1#B3")).toBeNull();
    expect(c.get("XYZ#Sheet1#A1")).not.toBeNull();
  });

  it("LRU evicts oldest when over capacity", () => {
    const c = new CacheStore({ persist: vi.fn(), maxEntries: 2 });
    c.set("a", makeEntry(1));
    c.set("b", makeEntry(2));
    c.get("a"); // bump a to most recent
    c.set("c", makeEntry(3)); // evicts b
    expect(c.get("a")).not.toBeNull();
    expect(c.get("b")).toBeNull();
    expect(c.get("c")).not.toBeNull();
  });

  it("debounces persist calls", async () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const c = new CacheStore({ persist, persistDebounceMs: 500 });
    c.set("a", makeEntry(1));
    c.set("b", makeEntry(2));
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("isStale returns true when entry older than ttl", () => {
    const c = new CacheStore({ persist: vi.fn() });
    const old = makeEntry(1, Date.now() - 10 * 60 * 1000);
    c.set("a", old);
    expect(c.isStale("a", 5 * 60 * 1000)).toBe(true);
    expect(c.isStale("a", 20 * 60 * 1000)).toBe(false);
  });
});
