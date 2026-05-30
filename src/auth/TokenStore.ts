export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

export class TokenStore {
  constructor(private safe: SafeStorageLike) {}

  encryptRefreshToken(token: string): string | null {
    if (!this.safe.isEncryptionAvailable()) return null;
    const enc = this.safe.encryptString(token);
    return enc.toString("base64");
  }

  decryptRefreshToken(b64: string): string | null {
    try {
      const buf = Buffer.from(b64, "base64");
      return this.safe.decryptString(buf);
    } catch {
      return null;
    }
  }
}
