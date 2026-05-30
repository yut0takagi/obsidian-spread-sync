import { Notice } from "obsidian";
import { SheetsClient } from "../sheets/SheetsClient";
import { DriveClient } from "../sheets/DriveClient";
import { CacheStore } from "../storage/CacheStore";

export interface EditableRenderDeps {
  sheets: SheetsClient;
  drive: DriveClient;
  cache: CacheStore;
  cacheKey: string;
}

export interface EditableRenderOpts {
  spreadsheetId: string;
  sheet: string;
  range: string; // A1 notation like "A19:C25"
  header: boolean;
  values: unknown[][];
  deps: EditableRenderDeps;
}

interface ParsedRange { startCol: number; startRow: number; endCol: number; endRow: number; }

function parseRange(range: string): ParsedRange {
  const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) throw new Error(`Editable mode requires range like A1:B2 (got "${range}")`);
  return {
    startCol: colToNum(m[1]),
    startRow: parseInt(m[2], 10),
    endCol: colToNum(m[3]),
    endRow: parseInt(m[4], 10),
  };
}

function colToNum(col: string): number {
  let n = 0;
  for (const c of col.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function numToCol(n: number): string {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export function renderEditableTable(host: HTMLElement, opts: EditableRenderOpts): void {
  (host as any).empty();
  const parsed = parseRange(opts.range);

  const wrapper = host.createDiv({ cls: "spread-sync-editable-wrapper" });
  const tableEl = wrapper.createEl("table", { cls: "spread-sync-editable" });

  // Headers
  const dataStartIdx = opts.header && opts.values.length > 0 ? 1 : 0;
  if (opts.header && opts.values.length > 0) {
    const thead = tableEl.createEl("thead");
    const tr = thead.createEl("tr");
    for (const cell of opts.values[0]) tr.createEl("th", { text: String(cell ?? "") });
  }

  const tbody = tableEl.createEl("tbody");
  const btn = wrapper.createEl("button", { cls: "spread-sync-push-btn", text: "Push changes (0)" });
  (btn as HTMLButtonElement).disabled = true;

  for (let r = dataStartIdx; r < opts.values.length; r++) {
    const tr = tbody.createEl("tr");
    const sheetRow = parsed.startRow + r;
    const cols = opts.values[r] ?? [];
    for (let c = 0; c < cols.length; c++) {
      const sheetCol = numToCol(parsed.startCol + c);
      const td = tr.createEl("td");
      const orig = cols[c] ?? "";
      td.setAttr("contenteditable", "true");
      td.setAttr("data-cell", `${sheetCol}${sheetRow}`);
      td.setAttr("data-original", String(orig));
      td.setText(String(orig));
      const refresh = () => updateDirty(tableEl, btn as HTMLButtonElement);
      td.addEventListener("input", refresh);
      td.addEventListener("blur", refresh);
    }
  }

  btn.addEventListener("click", async () => {
    await handlePush(tableEl, btn as HTMLButtonElement, opts);
  });
}

function updateDirty(table: HTMLElement, btn: HTMLButtonElement): void {
  const tds = Array.from(table.querySelectorAll("td"));
  let dirty = 0;
  for (const td of tds) {
    const orig = td.getAttribute("data-original") ?? "";
    const current = (td.textContent ?? "").trim();
    if (current !== orig) {
      (td as HTMLElement).addClass("dirty");
      dirty++;
    } else {
      (td as HTMLElement).removeClass("dirty");
    }
  }
  btn.disabled = dirty === 0;
  btn.setText(`Push changes (${dirty})`);
}

async function handlePush(table: HTMLElement, btn: HTMLButtonElement, opts: EditableRenderOpts): Promise<void> {
  const dirtyCells = Array.from(table.querySelectorAll("td.dirty")) as HTMLElement[];
  if (dirtyCells.length === 0) return;

  btn.disabled = true;
  const originalText = btn.textContent ?? "";
  btn.setText("Pushing…");

  try {
    // Conflict check via Drive modifiedTime
    const currentMt = await opts.deps.drive.getModifiedTime(opts.spreadsheetId);
    const cached = opts.deps.cache.get(opts.cacheKey);
    if (cached?.fileModifiedTime && cached.fileModifiedTime !== currentMt) {
      const overwrite = window.confirm(
        `Sheet was modified externally (modifiedTime changed).\n\nOverwrite anyway? Cancel to abort and refresh.`,
      );
      if (!overwrite) {
        new Notice("Push cancelled");
        btn.setText(originalText);
        btn.disabled = false;
        return;
      }
    }

    // Batch write all dirty cells
    const updates = dirtyCells.map((td) => ({
      sheet: opts.sheet,
      range: td.getAttribute("data-cell")!,
      value: (td.textContent ?? "").trim(),
    }));
    const result = await opts.deps.sheets.batchWrite(opts.spreadsheetId, updates);

    // Reset originals + clear dirty
    for (const td of dirtyCells) {
      const newVal = (td.textContent ?? "").trim();
      td.setAttribute("data-original", newVal);
      (td as HTMLElement).removeClass("dirty");
    }

    // Update cached modifiedTime so next push doesn't false-positive conflict
    const newMt = await opts.deps.drive.getModifiedTime(opts.spreadsheetId).catch(() => null);
    if (cached && newMt) {
      opts.deps.cache.set(opts.cacheKey, { ...cached, fileModifiedTime: newMt });
    }

    btn.setText("Push changes (0)");
    btn.disabled = true;
    new Notice(`Spread Sync: pushed ${result.updatedCells} cells`);
  } catch (e: any) {
    new Notice(`Push failed: ${e?.message ?? e}`);
    btn.setText(originalText);
    btn.disabled = false;
  }
}
