import { createHash, randomBytes } from "node:crypto";
import * as https from "node:https";
import { URL } from "node:url";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface PkcePair { verifier: string; challenge: string; }

export function generatePkcePair(): PkcePair {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface OAuthClientOpts {
  clientId: string;
  clientSecret?: string;  // Required by Google for Desktop ("installed") clients, even with PKCE.
  tokenEndpoint?: string;
  authEndpoint?: string;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
}

export interface AuthorizationUrlOpts {
  challenge: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}

export class OAuthClient {
  private readonly clientId: string;
  private readonly clientSecret: string | undefined;
  private readonly tokenEndpoint: string;
  private readonly authEndpoint: string;

  constructor(opts: OAuthClientOpts) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.tokenEndpoint = opts.tokenEndpoint ?? TOKEN_ENDPOINT;
    this.authEndpoint = opts.authEndpoint ?? AUTH_ENDPOINT;
  }

  buildAuthorizationUrl(opts: AuthorizationUrlOpts): string {
    const parts: string[] = [
      `response_type=code`,
      `client_id=${encodeURIComponent(this.clientId)}`,
      `redirect_uri=${encodeURIComponent(opts.redirectUri)}`,
      `scope=${encodeURIComponent(opts.scopes.join(" "))}`,
      `code_challenge=${encodeURIComponent(opts.challenge)}`,
      `code_challenge_method=S256`,
      `access_type=offline`,
      `prompt=consent`,
      `state=${encodeURIComponent(opts.state)}`,
    ];
    return `${this.authEndpoint}?${parts.join("&")}`;
  }

  async exchangeCodeForTokens(code: string, verifier: string, redirectUri: string): Promise<TokenExchangeResult> {
    const params: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: this.clientId,
      redirect_uri: redirectUri,
    };
    if (this.clientSecret) params.client_secret = this.clientSecret;
    const body = new URLSearchParams(params).toString();
    const data = await this.post(body);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
    const params: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
    };
    if (this.clientSecret) params.client_secret = this.clientSecret;
    const body = new URLSearchParams(params).toString();
    const data = await this.post(body);
    return { accessToken: data.access_token, expiresIn: data.expires_in };
  }

  private post(body: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(this.tokenEndpoint);
      const req = https.request(
        {
          method: "POST",
          hostname: u.hostname,
          path: u.pathname + u.search,
          timeout: 30_000,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body).toString(),
          },
        },
        (res) => {
          let chunks = "";
          res.on("data", (c) => (chunks += c));
          res.on("end", () => {
            let data: any = {};
            try { data = JSON.parse(chunks); } catch {}
            if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
              resolve(data);
            } else {
              const code = data?.error ?? `http_${res.statusCode}`;
              const desc = data?.error_description ?? "";
              reject(new Error(`OAuth error ${code}: ${desc}`));
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(new Error("OAuth POST timed out after 30s")); });
      req.write(body);
      req.end();
    });
  }

  hasClientId(): boolean {
    return this.clientId.trim().length > 0;
  }
}
