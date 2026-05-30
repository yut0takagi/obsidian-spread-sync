// alias → spreadsheetId. `undefined` keeps lookups safe at the type level
// (forces callers to handle missing aliases instead of silently producing undefined).
export type AliasMap = Record<string, string | undefined>;

export interface SpreadSyncSettings {
  encryptedRefreshToken: string | null;   // base64 of safeStorage-encrypted blob
  tokenExpiresAt: number | null;          // epoch ms for access_token (cached short-lived)
  accountEmail: string | null;
  aliases: AliasMap;
  staleTTLMinutes: number;
  staleWhileRevalidate: boolean;
  fetchOnOpen: boolean;
  refetchOnOnline: boolean;
  debugLog: boolean;
  apiEndpointOverride: string | null;     // null → official endpoints
  // User-provided OAuth credentials (Desktop "installed" client from their own GCP project).
  oauthClientId: string;
  oauthClientSecret: string;
}
