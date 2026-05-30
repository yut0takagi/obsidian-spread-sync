import { describe, it, expect, vi } from "vitest";
import { TokenStore, SafeStorageLike } from "../src/auth/TokenStore";

function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (b: Buffer) => b.toString("utf8").replace(/^enc:/, ""),
  };
}

describe("TokenStore", () => {
  it("encrypts on save, decrypts on load", () => {
    const ss = fakeSafeStorage();
    const ts = new TokenStore(ss);
    const blob = ts.encryptRefreshToken("refresh-abc");
    expect(typeof blob).toBe("string");
    expect(blob).not.toContain("refresh-abc");
    expect(ts.decryptRefreshToken(blob)).toBe("refresh-abc");
  });

  it("returns null when encryption unavailable", () => {
    const ss = { ...fakeSafeStorage(), isEncryptionAvailable: () => false };
    const ts = new TokenStore(ss);
    expect(ts.encryptRefreshToken("x")).toBeNull();
  });

  it("returns null when input blob is corrupted", () => {
    const ss = fakeSafeStorage();
    ss.decryptString = vi.fn(() => { throw new Error("bad"); });
    const ts = new TokenStore(ss);
    expect(ts.decryptRefreshToken("!@#$")).toBeNull();
  });
});
