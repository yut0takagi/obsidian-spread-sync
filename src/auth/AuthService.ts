import { OAuthClient, generatePkcePair } from "./OAuthClient";
import { TokenStore } from "./TokenStore";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import * as https from "node:https";
import { randomBytes } from "node:crypto";
import { OAUTH_SCOPES } from "../settings/defaults";

export interface AuthPersistence {
  save(data: { encryptedRefreshToken: string | null; tokenExpiresAt: number | null; accountEmail: string | null }): Promise<void>;
  load(): { encryptedRefreshToken: string | null; tokenExpiresAt: number | null; accountEmail: string | null };
}

export interface OpenExternal { (url: string): void; }

export class AuthService {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(
    private oauth: OAuthClient,
    private tokenStore: TokenStore,
    private persistence: AuthPersistence,
    private openExternal: OpenExternal,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    const { encryptedRefreshToken } = this.persistence.load();
    if (!encryptedRefreshToken) throw new Error("Not signed in. Open settings and click Sign in with Google.");
    const refreshToken = this.tokenStore.decryptRefreshToken(encryptedRefreshToken);
    if (!refreshToken) throw new Error("Could not decrypt stored token. Please sign in again.");
    try {
      const r = await this.oauth.refreshAccessToken(refreshToken);
      this.accessToken = r.accessToken;
      this.accessTokenExpiresAt = Date.now() + r.expiresIn * 1000;
      return this.accessToken;
    } catch (e: any) {
      if (String(e?.message ?? "").includes("invalid_grant")) {
        await this.signOut();
        throw new Error("Google sign-in expired (7-day refresh expiry). Please sign in again.");
      }
      throw e;
    }
  }

  async signIn(): Promise<void> {
    if (!this.oauth.hasClientId()) {
      throw new Error("OAuth client_id not configured. Open settings to enter your Google Cloud OAuth credentials.");
    }
    const { verifier, challenge } = generatePkcePair();
    const state = randomState();
    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
        const gotState = url.searchParams.get("state");
        const gotCode = url.searchParams.get("code");
        const port = (server.address() as AddressInfo).port;
        const ru = `http://127.0.0.1:${port}/callback`;
        if (gotState !== state || !gotCode) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Sign-in failed</h1>");
          server.close();
          clearTimeout(timeoutId);
          reject(new Error("OAuth state mismatch or missing code"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Signed in to Spread Sync. You can close this tab.</h1>");
        server.close();
        clearTimeout(timeoutId);
        resolve({ code: gotCode, redirectUri: ru });
      });
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as AddressInfo).port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const url = this.oauth.buildAuthorizationUrl({ challenge, redirectUri, scopes: OAUTH_SCOPES, state });
        this.openExternal(url);
      });
      const timeoutId = setTimeout(() => {
        server.close();
        reject(new Error("Sign-in timed out (5 minutes). Please try again."));
      }, 5 * 60_000);
      server.on("error", (err) => { clearTimeout(timeoutId); reject(err); });
    });
    const tokens = await this.oauth.exchangeCodeForTokens(code, verifier, redirectUri);
    if (!tokens.refreshToken) {
      throw new Error("Google did not return a refresh_token. Try revoking access at https://myaccount.google.com/permissions and signing in again.");
    }
    const encryptedRefreshToken = this.tokenStore.encryptRefreshToken(tokens.refreshToken);
    if (!encryptedRefreshToken) throw new Error("Encryption not available — cannot persist refresh token on this machine.");
    this.accessToken = tokens.accessToken;
    this.accessTokenExpiresAt = Date.now() + tokens.expiresIn * 1000;
    await this.persistence.save({
      encryptedRefreshToken,
      tokenExpiresAt: this.accessTokenExpiresAt,
      accountEmail: await this.fetchAccountEmail(this.accessToken),
    });
  }

  async signOut(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    await this.persistence.save({ encryptedRefreshToken: null, tokenExpiresAt: null, accountEmail: null });
  }

  private fetchAccountEmail(accessToken: string): Promise<string | null> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          method: "GET",
          hostname: "www.googleapis.com",
          path: "/oauth2/v3/userinfo",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              const data = JSON.parse(body);
              resolve(data?.email ?? null);
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on("error", () => resolve(null));
      req.end();
    });
  }
}

function randomState(): string {
  return randomBytes(16).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
