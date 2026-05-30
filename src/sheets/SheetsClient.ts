import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { ApiError, RangeSpec, ReadResult, WriteResult } from "./types";

export interface AuthLike {
  getAccessToken(): Promise<string>;
}

export interface SheetsClientOpts {
  endpoint?: string;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxRetries?: number;
}

const DEFAULT_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets";

function buildRange(spec: RangeSpec): string {
  if (spec.range) return `${spec.sheet}!${spec.range}`;
  if (spec.named) return spec.named; // named ranges are top-level
  return spec.sheet;
}

function httpRequest(urlStr: string, options: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
    };

    const req = lib.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export class SheetsClient {
  private readonly endpoint: string;
  private readonly initialBackoff: number;
  private readonly maxBackoff: number;
  private readonly maxRetries: number;

  constructor(private auth: AuthLike, opts: SheetsClientOpts = {}) {
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.initialBackoff = opts.initialBackoffMs ?? 2000;
    this.maxBackoff = opts.maxBackoffMs ?? 32000;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  async read(spreadsheetId: string, spec: RangeSpec): Promise<ReadResult> {
    const range = buildRange(spec);
    const url = `${this.endpoint}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const data = await this.requestWithRetry(url);
    return {
      range: data.range ?? range,
      values: (data.values ?? []) as unknown[][],
    };
  }

  async batchRead(spreadsheetId: string, specs: RangeSpec[]): Promise<ReadResult[]> {
    if (specs.length === 0) return [];
    const ranges = specs.map(buildRange);
    const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const url = `${this.endpoint}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${qs}`;
    const data = await this.requestWithRetry(url);
    return (data.valueRanges ?? []).map((vr: { range?: string; values?: unknown[][] }, i: number) => ({
      range: vr.range ?? ranges[i],
      values: vr.values ?? [],
    }));
  }

  async write(
    spreadsheetId: string,
    spec: RangeSpec,
    value: unknown,
    mode: "replace" | "append",
  ): Promise<WriteResult> {
    const range = buildRange(spec);
    const body = JSON.stringify({ values: normalizeValues(value), range });

    if (mode === "append") {
      const url = `${this.endpoint}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      const data = await this.requestWithRetry(url, { method: "POST", body, headers: { "Content-Type": "application/json" } });
      return {
        updatedRange: data.updates?.updatedRange ?? range,
        updatedCells: data.updates?.updatedCells ?? 0,
      };
    }

    const url = `${this.endpoint}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const data = await this.requestWithRetry(url, { method: "PUT", body, headers: { "Content-Type": "application/json" } });
    return {
      updatedRange: data.updatedRange ?? range,
      updatedCells: data.updatedCells ?? 0,
    };
  }

  // Write multiple ranges in one request. Each entry: { sheet, range, value }.
  // Returns total cells updated.
  async batchWrite(
    spreadsheetId: string,
    updates: Array<{ sheet: string; range: string; value: unknown }>,
  ): Promise<{ updatedCells: number }> {
    if (updates.length === 0) return { updatedCells: 0 };
    const url = `${this.endpoint}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
    const body = JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({
        range: `${u.sheet}!${u.range}`,
        values: normalizeValues(u.value),
      })),
    });
    const data = await this.requestWithRetry(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    return { updatedCells: data.totalUpdatedCells ?? 0 };
  }

  private async requestWithRetry(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<any> {
    let attempt = 0;
    let backoff = this.initialBackoff;
    while (true) {
      const token = await this.auth.getAccessToken();
      const headers: Record<string, string> = {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      };

      const res = await httpRequest(url, { ...init, headers });

      if (res.status >= 200 && res.status < 300) {
        return safeJson(res.body);
      }

      const parsed = safeJson(res.body);
      const code = parsed?.error?.status ?? `HTTP_${res.status}`;
      const message = parsed?.error?.message ?? res.body;

      if (res.status === 429 && attempt < this.maxRetries) {
        await sleep(backoff);
        backoff = Math.min(backoff * 2, this.maxBackoff);
        attempt += 1;
        continue;
      }
      throw new ApiError(res.status, code, message);
    }
  }
}

function safeJson(s: string): any { try { return JSON.parse(s); } catch { return null; } }
function sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

function normalizeValues(v: unknown): unknown[][] {
  if (Array.isArray(v) && Array.isArray(v[0])) return v as unknown[][];
  if (Array.isArray(v)) return [v as unknown[]];
  return [[v]];
}
