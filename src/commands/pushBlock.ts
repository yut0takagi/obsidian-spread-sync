import { App, MarkdownView, Notice, Modal, Setting } from "obsidian";
import { parseWriteBlock } from "../renderer/parser";
import { resolveSpreadsheetId } from "../renderer/idResolver";
import { SheetsClient } from "../sheets/SheetsClient";
import { DriveClient } from "../sheets/DriveClient";
import { CacheStore } from "../storage/CacheStore";
import { AliasMap } from "../settings/types";

export interface PushDeps {
  app: App;
  sheets: SheetsClient;
  drive: DriveClient;
  cache: CacheStore;
  aliases: () => AliasMap;
}

interface BlockLocation { startLine: number; endLine: number; source: string; }

function findEnclosingWriteBlock(text: string, cursorLine: number): BlockLocation | null {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i <= cursorLine; i++) {
    if (lines[i].startsWith("```spread-write")) start = i;
    else if (lines[i].startsWith("```") && start !== -1 && i > start) start = -1;
  }
  if (start === -1) return null;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("```")) { end = i; break; }
  }
  if (end === -1 || end < cursorLine) return null;
  return { startLine: start, endLine: end, source: lines.slice(start + 1, end).join("\n") };
}

function readPushedComment(text: string, blockEndLine: number): { modifiedTime: string | null; value: string | null } {
  const lines = text.split(/\r?\n/);
  const next = lines[blockEndLine + 1] ?? "";
  const m = next.match(/^<!--\s*pushed:\s*([^,]+),\s*modifiedTime:\s*([^,]+)(?:,\s*value:\s*(.*?))?\s*-->/);
  if (!m) return { modifiedTime: null, value: null };
  return { modifiedTime: m[2].trim(), value: m[3]?.trim() ?? null };
}

class ConfirmModal extends Modal {
  constructor(app: App, private title: string, private body: string, private onChoice: (choice: "overwrite" | "diff" | "cancel") => void) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.body });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Overwrite").setWarning().onClick(() => { this.close(); this.onChoice("overwrite"); }))
      .addButton((b) => b.setButtonText("Read & diff").onClick(() => { this.close(); this.onChoice("diff"); }))
      .addButton((b) => b.setButtonText("Cancel").onClick(() => { this.close(); this.onChoice("cancel"); }));
  }
  onClose() { this.contentEl.empty(); }
}

export async function pushCurrentBlock(deps: PushDeps): Promise<void> {
  const view = deps.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) { new Notice("No active markdown file"); return; }
  const editor = view.editor;
  const cursor = editor.getCursor();
  const text = editor.getValue();
  const loc = findEnclosingWriteBlock(text, cursor.line);
  if (!loc) { new Notice("Cursor is not inside a spread-write block"); return; }

  const parsed = parseWriteBlock(loc.source);
  if (!parsed.ok) { new Notice(`Spread Sync: ${parsed.error}`); return; }
  const resolved = resolveSpreadsheetId(parsed.block.idArg, deps.aliases());
  if (!resolved.ok) { new Notice(`Spread Sync: ${resolved.error}`); return; }

  const valueJson = JSON.stringify(parsed.block.value);
  const lastPushed = readPushedComment(text, loc.endLine);
  if (lastPushed.value === valueJson) { new Notice("Spread Sync: no change since last push"); return; }

  let currentModifiedTime: string;
  try {
    currentModifiedTime = await deps.drive.getModifiedTime(resolved.id);
  } catch (e: any) {
    new Notice(`Spread Sync: cannot fetch modifiedTime: ${e?.message ?? e}`);
    return;
  }

  if (lastPushed.modifiedTime && lastPushed.modifiedTime !== currentModifiedTime) {
    const choice = await new Promise<"overwrite" | "diff" | "cancel">((resolve) =>
      new ConfirmModal(
        deps.app,
        "Spread Sync: conflict detected",
        `Sheet was modified externally (modifiedTime changed). Continue?`,
        resolve,
      ).open(),
    );
    if (choice === "cancel") { new Notice("Push cancelled"); return; }
    if (choice === "diff") {
      try {
        const current = await deps.sheets.read(resolved.id, parseTargetToSpec(parsed.block.sheet, parsed.block.target));
        const proceed = await new Promise<"overwrite" | "diff" | "cancel">((resolve) =>
          new ConfirmModal(
            deps.app,
            "Sheet current value",
            `Current: ${JSON.stringify(current.values)}\nLocal: ${valueJson}`,
            resolve,
          ).open(),
        );
        if (proceed !== "overwrite") { new Notice("Push cancelled"); return; }
      } catch (e: any) {
        new Notice(`Spread Sync: cannot read for diff: ${e?.message ?? e}`); return;
      }
    }
  }

  try {
    await deps.sheets.write(
      resolved.id,
      parseTargetToSpec(parsed.block.sheet, parsed.block.target),
      parsed.block.value,
      parsed.block.mode,
    );
  } catch (e: any) {
    new Notice(`Spread Sync: write failed: ${e?.message ?? e}`); return;
  }

  const newModifiedTime = await deps.drive.getModifiedTime(resolved.id).catch(() => currentModifiedTime);
  const commentLine = `<!-- pushed: ${new Date().toISOString()}, modifiedTime: ${newModifiedTime}, value: ${valueJson} -->`;
  const lines = text.split(/\r?\n/);
  if (lastPushed.modifiedTime || lastPushed.value) {
    lines[loc.endLine + 1] = commentLine;
  } else {
    lines.splice(loc.endLine + 1, 0, commentLine);
  }
  editor.setValue(lines.join("\n"));

  deps.cache.invalidatePrefix(`${resolved.id}#`);
  new Notice("Spread Sync: pushed");
}

function parseTargetToSpec(sheet: string, target: string): { sheet: string; range: string } {
  return { sheet, range: target };
}
