import { MarkdownPostProcessorContext, MarkdownRenderer, Component } from "obsidian";
import { parseSyncBlock, parseWriteBlock, SyncBlock } from "./parser";
import { resolveSpreadsheetId } from "./idResolver";
import { renderBadge } from "./errorBadge";
import { toMarkdownTable } from "./tableFormatter";
import { renderEditableTable } from "./editableTableRenderer";
import { AliasMap } from "../settings/types";
import { SheetsClient } from "../sheets/SheetsClient";
import { DriveClient } from "../sheets/DriveClient";
import { CacheStore } from "../storage/CacheStore";

export interface BlockDeps {
  sheets: SheetsClient;
  drive: DriveClient;
  cache: CacheStore;
  aliases: () => AliasMap;
  staleTtlMs: () => number;
  staleWhileRevalidate: () => boolean;
  onAuthError: () => void;
  isOffline: () => boolean;
  hostComponent: Component;
}

export function registerSyncBlockProcessor(plugin: { registerMarkdownCodeBlockProcessor: any }, deps: BlockDeps) {
  plugin.registerMarkdownCodeBlockProcessor(
    "spread-sync",
    async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const parsed = parseSyncBlock(source);
      if (!parsed.ok) {
        renderBadge(el, { kind: "range", text: "⚠ syntax error", tooltip: parsed.error });
        return;
      }
      const resolved = resolveSpreadsheetId(parsed.block.idArg, deps.aliases());
      if (!resolved.ok) {
        renderBadge(el, { kind: "range", text: "⚠ id error", tooltip: resolved.error });
        return;
      }
      const key = buildCacheKey(resolved.id, parsed.block);
      const spec = blockToSpec(parsed.block);
      const cached = deps.cache.get(key);
      if (cached && !deps.cache.isStale(key, deps.staleTtlMs())) {
        await renderTable(el, ctx, cached.value as unknown[][], parsed.block, deps.hostComponent, resolved.id, key, deps);
        // Skip SWR for editable tables — would clobber in-progress user edits.
        if (!parsed.block.editable && deps.staleWhileRevalidate() && !deps.isOffline()) {
          tryFetch(el, ctx, deps, resolved.id, spec, key, parsed.block).catch(() => {});
        }
        return;
      }
      if (deps.isOffline()) {
        if (cached) {
          await renderTable(el, ctx, cached.value as unknown[][], parsed.block, deps.hostComponent, resolved.id, key, deps);
          renderBadge(el, { kind: "offline", text: "⚠ offline" });
        } else {
          renderBadge(el, { kind: "offline", text: "⚠ offline (no cache)" });
        }
        return;
      }
      await tryFetch(el, ctx, deps, resolved.id, spec, key, parsed.block);
    },
  );

  plugin.registerMarkdownCodeBlockProcessor(
    "spread-write",
    (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
      const parsed = parseWriteBlock(source);
      if (!parsed.ok) {
        renderBadge(el, { kind: "range", text: "⚠ write syntax error", tooltip: parsed.error });
        return;
      }
      const pre = (el as any).createEl("pre", { cls: "spread-sync-write-preview" });
      (pre as any).setText(`spread-write → ${parsed.block.sheet}!${parsed.block.target} (${parsed.block.mode})\nvalue: ${JSON.stringify(parsed.block.value)}`);
      const hint = (el as any).createEl("div", { cls: "spread-sync-write-hint" });
      (hint as any).setText("Run 'Spread Sync: Push this block' from the command palette to send.");
    },
  );
}

function blockToSpec(block: { sheet: string; range: string | null; named: string | null }) {
  if (block.range) return { sheet: block.sheet, range: block.range };
  if (block.named) return { sheet: block.sheet, named: block.named };
  return { sheet: block.sheet };
}

function buildCacheKey(id: string, block: { sheet: string; range: string | null; named: string | null; whole: boolean }) {
  return `${id}#${block.sheet}#${block.range ?? block.named ?? "_all"}`;
}

async function renderTable(
  host: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  values: unknown[][],
  block: SyncBlock,
  component: Component,
  spreadsheetId: string,
  cacheKey: string,
  deps: BlockDeps,
) {
  (host as any).empty();
  if (block.editable && block.range && !block.transpose) {
    renderEditableTable(host, {
      spreadsheetId,
      sheet: block.sheet,
      range: block.range,
      header: block.header,
      values,
      deps: { sheets: deps.sheets, drive: deps.drive, cache: deps.cache, cacheKey },
    });
    return;
  }
  const md = toMarkdownTable(values, { header: block.header, transpose: block.transpose });
  await MarkdownRenderer.render(((window as any).app ?? (host as any).app), md, host, ctx.sourcePath, component);
}

async function tryFetch(
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  deps: BlockDeps,
  spreadsheetId: string,
  spec: { sheet: string; range?: string; named?: string },
  cacheKey: string,
  block: SyncBlock,
) {
  try {
    const r = await deps.sheets.read(spreadsheetId, spec);
    // For editable mode, also record file modifiedTime in cache for conflict detection on push.
    let fileModifiedTime: string | null = null;
    if (block.editable) {
      try { fileModifiedTime = await deps.drive.getModifiedTime(spreadsheetId); } catch {}
    }
    deps.cache.set(cacheKey, { value: r.values, fetchedAt: Date.now(), fileModifiedTime });
    await renderTable(el, ctx, r.values, block, deps.hostComponent, spreadsheetId, cacheKey, deps);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status: number | undefined = typeof e?.status === "number" ? e.status : undefined;
    if (/Not signed in|sign-in expired|invalid_grant/.test(msg)) {
      (el as any).empty();
      renderBadge(el, { kind: "auth", text: "⚠ re-auth", tooltip: msg, onClick: deps.onAuthError });
      return;
    }
    if (status === 403 || status === 404 || /PERMISSION_DENIED|NOT_FOUND/.test(msg)) {
      (el as any).empty();
      renderBadge(el, { kind: "access", text: "⚠ no access", tooltip: msg });
      return;
    }
    if (/Office file|not be an Office file/.test(msg)) {
      (el as any).empty();
      renderBadge(el, { kind: "access", text: "⚠ Excel format", tooltip: "This file is uploaded as .xlsx. Convert to native Google Sheets first (File → Save as Google Sheets)." });
      return;
    }
    const cached = deps.cache.get(cacheKey);
    if (cached) {
      await renderTable(el, ctx, cached.value as unknown[][], block, deps.hostComponent, spreadsheetId, cacheKey, deps);
      const ageMin = Math.round((Date.now() - cached.fetchedAt) / 60_000);
      renderBadge(el, { kind: "stale", text: `⚠ stale ${ageMin}m`, tooltip: msg });
      return;
    }
    (el as any).empty();
    renderBadge(el, { kind: "fetch", text: "⚠ fetch failed", tooltip: msg });
  }
}
