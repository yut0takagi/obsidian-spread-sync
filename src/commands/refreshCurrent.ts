import { App, MarkdownView, Notice } from "obsidian";
import { CacheStore } from "../storage/CacheStore";
import { parseInlineCall, parseSyncBlock } from "../renderer/parser";
import { resolveSpreadsheetId } from "../renderer/idResolver";
import { AliasMap } from "../settings/types";

export interface RefreshDeps {
  app: App;
  cache: CacheStore;
  aliases: () => AliasMap;
  rerender: () => void;
}

export function refreshCurrentFile(deps: RefreshDeps): void {
  const view = deps.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) { new Notice("No active markdown file"); return; }
  const text = view.editor.getValue();
  const keys = collectKeys(text, deps.aliases());
  for (const k of keys) deps.cache.invalidate(k);
  new Notice(`Spread Sync: invalidated ${keys.length} entries`);
  deps.rerender();
}

export function collectKeys(text: string, aliases: AliasMap): string[] {
  const keys: string[] = [];

  // Matches both `spread_sync(...)` and the legacy `= spread_sync(...)` form.
  const inlineRe = /`(?:=\s*)?(spread_sync\([^`]+\))\s*`/g;
  for (const m of text.matchAll(inlineRe)) {
    const parsed = parseInlineCall(m[1]);
    if (!parsed.ok) continue;
    const resolved = resolveSpreadsheetId(parsed.call.idArg, aliases);
    if (!resolved.ok) continue;
    keys.push(`${resolved.id}#${parsed.call.sheet}#${parsed.call.target}`);
  }

  const blockRe = /```spread-sync\n([\s\S]*?)```/g;
  for (const m of text.matchAll(blockRe)) {
    const parsed = parseSyncBlock(m[1]);
    if (!parsed.ok) continue;
    const resolved = resolveSpreadsheetId(parsed.block.idArg, aliases);
    if (!resolved.ok) continue;
    keys.push(`${resolved.id}#${parsed.block.sheet}#${parsed.block.range ?? parsed.block.named ?? "_all"}`);
  }

  return keys;
}
