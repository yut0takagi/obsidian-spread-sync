import { App, Notice, Modal, Setting } from "obsidian";
import { CacheStore } from "../storage/CacheStore";
import { AliasMap } from "../settings/types";
import { resolveSpreadsheetId } from "../renderer/idResolver";

export interface RefreshByIdDeps {
  app: App;
  cache: CacheStore;
  aliases: () => AliasMap;
  rerender: () => void;
}

class PromptModal extends Modal {
  constructor(app: App, private onSubmit: (val: string) => void) { super(app); }
  onOpen() {
    let val = "";
    new Setting(this.contentEl).setName("Spreadsheet id / URL / @alias")
      .addText((t) => t.onChange((v) => (val = v)));
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("Invalidate").setCta().onClick(() => { this.close(); this.onSubmit(val); }),
    );
  }
  onClose() { this.contentEl.empty(); }
}

export function refreshBySpreadsheet(deps: RefreshByIdDeps): void {
  new PromptModal(deps.app, (input) => {
    const resolved = resolveSpreadsheetId(input.trim(), deps.aliases());
    if (!resolved.ok) { new Notice(`Spread Sync: ${resolved.error}`); return; }
    deps.cache.invalidatePrefix(`${resolved.id}#`);
    new Notice(`Spread Sync: invalidated all entries for ${resolved.id}`);
    deps.rerender();
  }).open();
}
