import { SpreadSyncSettings } from "./types";

export const DEFAULT_SETTINGS: SpreadSyncSettings = {
  encryptedRefreshToken: null,
  tokenExpiresAt: null,
  accountEmail: null,
  aliases: {},
  staleTTLMinutes: 5,
  staleWhileRevalidate: true,
  fetchOnOpen: true,
  refetchOnOnline: false,
  debugLog: false,
  apiEndpointOverride: null,
  oauthClientId: "",
  oauthClientSecret: "",
};

export const SHEETS_ENDPOINT = (override: string | null) =>
  override ?? "https://sheets.googleapis.com/v4/spreadsheets";

export const DRIVE_ENDPOINT = (override: string | null) =>
  override ?? "https://www.googleapis.com/drive/v3/files";

export const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const OAUTH_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];
