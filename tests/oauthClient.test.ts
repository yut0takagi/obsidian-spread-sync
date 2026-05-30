import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { OAuthClient, generatePkcePair } from "../src/auth/OAuthClient";

beforeEach(() => nock.cleanAll());
afterEach(() => nock.cleanAll());

describe("generatePkcePair", () => {
  it("returns verifier 43-128 chars and challenge S256 base64url", () => {
    const { verifier, challenge } = generatePkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("different calls produce different verifiers", () => {
    const a = generatePkcePair(); const b = generatePkcePair();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("OAuthClient.exchangeCodeForTokens", () => {
  it("POSTs to token endpoint and returns tokens", async () => {
    const bodyHas = (body: any, ...terms: string[]) =>
      typeof body === "string"
        ? terms.every((t) => body.includes(t))
        : terms.every((t) => Object.entries(body).some(([k, v]) => `${k}=${v}`.includes(t)));
    nock("https://oauth2.googleapis.com")
      .post("/token", (body) => bodyHas(body, "code=AUTH_CODE", "code_verifier=VERIFIER"))
      .reply(200, { access_token: "AT", refresh_token: "RT", expires_in: 3600 });
    const c = new OAuthClient({ clientId: "client.apps.googleusercontent.com" });
    const r = await c.exchangeCodeForTokens("AUTH_CODE", "VERIFIER", "http://127.0.0.1:1234/callback");
    expect(r).toEqual({ accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  });

  it("throws on non-200", async () => {
    nock("https://oauth2.googleapis.com").post("/token").reply(400, { error: "invalid_grant", error_description: "bad" });
    const c = new OAuthClient({ clientId: "client.apps.googleusercontent.com" });
    await expect(c.exchangeCodeForTokens("X", "Y", "Z")).rejects.toThrow(/invalid_grant/);
  });
});

describe("OAuthClient.refreshAccessToken", () => {
  it("POSTs refresh and returns new access token", async () => {
    const bodyHas = (body: any, ...terms: string[]) =>
      typeof body === "string"
        ? terms.every((t) => body.includes(t))
        : terms.every((t) => Object.entries(body).some(([k, v]) => `${k}=${v}`.includes(t)));
    nock("https://oauth2.googleapis.com")
      .post("/token", (body) => bodyHas(body, "refresh_token=RT", "grant_type=refresh_token"))
      .reply(200, { access_token: "AT2", expires_in: 3600 });
    const c = new OAuthClient({ clientId: "client.apps.googleusercontent.com" });
    const r = await c.refreshAccessToken("RT");
    expect(r).toEqual({ accessToken: "AT2", expiresIn: 3600 });
  });

  it("throws invalid_grant when refresh expired", async () => {
    nock("https://oauth2.googleapis.com").post("/token").reply(400, { error: "invalid_grant" });
    const c = new OAuthClient({ clientId: "client.apps.googleusercontent.com" });
    await expect(c.refreshAccessToken("RT")).rejects.toThrow(/invalid_grant/);
  });
});

describe("OAuthClient.buildAuthorizationUrl", () => {
  it("includes code_challenge, scopes, redirect_uri", () => {
    const c = new OAuthClient({ clientId: "client.apps.googleusercontent.com" });
    const url = c.buildAuthorizationUrl({
      challenge: "CH",
      redirectUri: "http://127.0.0.1:1234/callback",
      scopes: ["a", "b"],
      state: "STATE",
    });
    expect(url).toContain("code_challenge=CH");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain(encodeURIComponent("http://127.0.0.1:1234/callback"));
    expect(url).toContain("scope=" + encodeURIComponent("a b"));
    expect(url).toContain("state=STATE");
  });
});
