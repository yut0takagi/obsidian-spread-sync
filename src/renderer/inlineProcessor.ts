import { MarkdownPostProcessorContext } from "obsidian";
import { parseInlineCall } from "./parser";
import { resolveSpreadsheetId } from "./idResolver";
import { renderBadge } from "./errorBadge";
import { AliasMap } from "../settings/types";
import { SheetsClient } from "../sheets/SheetsClient";
import { CacheStore } from "../storage/CacheStore";

export interface InlineDeps {
  sheets: SheetsClient;
  cache: CacheStore;
  aliases: () => AliasMap;
  staleTtlMs: () => number;
  staleWhileRevalidate: () => boolean;
  onAuthError: () => void;
  isOffline: () => boolean;
}

// Detect by function-name prefix so we don't collide with Dataview's `= ...` inline queries.
// Accepted forms: `spread_sync(...)` or `= spread_sync(...)` (legacy/compat — Dataview will error
// on the `=` form first, so users should prefer the plain form).

export function makeInlineProcessor(deps: InlineDeps) {
  return async (el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
    const codes = Array.from(el.querySelectorAll("code"));
    for (const code of codes) {
      const text = (code.textContent ?? "").trim();
      const expr = text.startsWith("=") ? text.slice(1).trim() : text;
      if (!/^spread_sync\(/.test(expr)) continue;

      const parsed = parseInlineCall(expr);
      if (!parsed.ok) {
        replaceWithBadge(code, { kind: "range", text: "⚠ syntax error", tooltip: parsed.error });
        continue;
      }

      const resolved = resolveSpreadsheetId(parsed.call.idArg, deps.aliases());
      if (!resolved.ok) {
        replaceWithBadge(code, { kind: "range", text: "⚠ id error", tooltip: resolved.error });
        continue;
      }

      const cacheKey = `${resolved.id}#${parsed.call.sheet}#${parsed.call.target}`;
      const isCell = /^[A-Z]+\d+$/i.test(parsed.call.target);
      const spec = isCell
        ? { sheet: parsed.call.sheet, range: parsed.call.target }
        : { sheet: parsed.call.sheet, named: parsed.call.target };

      const cached = deps.cache.get(cacheKey);
      if (cached && !deps.cache.isStale(cacheKey, deps.staleTtlMs())) {
        const display = replaceWithText(code, formatInlineValue(cached.value));
        if (deps.staleWhileRevalidate() && !deps.isOffline()) {
          fetchAndUpdate(display, deps, resolved.id, spec, cacheKey, false);
        }
        continue;
      }

      if (deps.isOffline() && cached) {
        const wrap = wrapNode(code, formatInlineValue(cached.value));
        renderBadge(wrap, { kind: "offline", text: "⚠ offline", tooltip: "Last fetched while online" });
        continue;
      }

      if (deps.isOffline()) {
        replaceWithBadge(code, { kind: "offline", text: "⚠ offline" });
        continue;
      }

      await fetchAndUpdate(code, deps, resolved.id, spec, cacheKey, true);
    }
  };
}

async function fetchAndUpdate(
  code: HTMLElement,
  deps: InlineDeps,
  spreadsheetId: string,
  spec: { sheet: string; range?: string; named?: string },
  cacheKey: string,
  showLoading: boolean,
): Promise<void> {
  if (showLoading) (code as any).setText("…");
  try {
    const result = await deps.sheets.read(spreadsheetId, spec);
    const value = result.values?.[0]?.[0] ?? "";
    if (result.values.length > 1 || (result.values[0]?.length ?? 0) > 1) {
      replaceWithBadge(code, { kind: "range", text: "⚠ range error", tooltip: "Inline syntax requires a single cell" });
      return;
    }
    deps.cache.set(cacheKey, { value, fetchedAt: Date.now(), fileModifiedTime: null });
    replaceWithText(code, formatInlineValue(value));
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status: number | undefined = typeof e?.status === "number" ? e.status : undefined;
    if (/Not signed in|sign-in expired|invalid_grant/.test(msg)) {
      replaceWithBadge(code, {
        kind: "auth", text: "⚠ re-auth",
        tooltip: msg, onClick: deps.onAuthError,
      });
      return;
    }
    if (status === 403 || status === 404 || /PERMISSION_DENIED|NOT_FOUND/.test(msg)) {
      replaceWithBadge(code, { kind: "access", text: "⚠ no access", tooltip: msg });
      return;
    }
    if (/Office file|not be an Office file/.test(msg)) {
      replaceWithBadge(code, { kind: "access", text: "⚠ Excel format", tooltip: "This file is uploaded as .xlsx. Convert to native Google Sheets first (File → Save as Google Sheets)." });
      return;
    }
    const cached = deps.cache.get(cacheKey);
    if (cached) {
      const ageMin = Math.round((Date.now() - cached.fetchedAt) / 60_000);
      const wrap = wrapNode(code, formatInlineValue(cached.value));
      renderBadge(wrap, { kind: "stale", text: `(⚠ stale ${ageMin}m)`, tooltip: msg });
      return;
    }
    replaceWithBadge(code, { kind: "fetch", text: "⚠ fetch failed", tooltip: msg });
  }
}

function formatInlineValue(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function replaceWithText(code: HTMLElement, text: string): HTMLElement {
  const span = document.createElement("span");
  (span as any).addClass("spread-sync-inline");
  (span as any).setText(text);
  code.replaceWith(span);
  return span;
}

function replaceWithBadge(code: HTMLElement, opts: Parameters<typeof renderBadge>[1]): void {
  const span = document.createElement("span");
  code.replaceWith(span);
  renderBadge(span, opts);
}

function wrapNode(code: HTMLElement, text: string): HTMLElement {
  const wrap = document.createElement("span");
  (wrap as any).addClass("spread-sync-inline");
  (wrap as any).setText(text + " ");
  code.replaceWith(wrap);
  return wrap;
}
