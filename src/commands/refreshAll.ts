import { App, MarkdownView, Notice } from "obsidian";
import { CacheStore } from "../storage/CacheStore";
import { AliasMap } from "../settings/types";
import { collectKeys } from "./refreshCurrent";

export interface RefreshAllDeps {
  app: App;
  cache: CacheStore;
  aliases: () => AliasMap;
  rerender: () => void;
}

export function refreshAllOpenFiles(deps: RefreshAllDeps): void {
  let total = 0;
  const leaves = deps.app.workspace.getLeavesOfType("markdown");
  for (const leaf of leaves) {
    const view = leaf.view as MarkdownView;
    const text = view.editor.getValue();
    const keys = collectKeys(text, deps.aliases());
    for (const k of keys) deps.cache.invalidate(k);
    total += keys.length;
  }
  new Notice(`Spread Sync: invalidated ${total} entries across ${leaves.length} files`);
  deps.rerender();
}
