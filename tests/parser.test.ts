import { describe, it, expect } from "vitest";
import { parseInlineCall, parseSyncBlock, parseWriteBlock } from "../src/renderer/parser";

describe("parseInlineCall", () => {
  it("parses spread_sync with id, sheet, cell", () => {
    expect(parseInlineCall(`spread_sync("1ABC", "Sheet1", "B3")`)).toEqual({
      ok: true,
      call: { fn: "spread_sync", idArg: "1ABC", sheet: "Sheet1", target: "B3" },
    });
  });

  it("parses with URL as id", () => {
    const url = "https://docs.google.com/spreadsheets/d/1ABC/edit";
    expect(parseInlineCall(`spread_sync("${url}", "Sheet1", "B3")`)).toEqual({
      ok: true,
      call: { fn: "spread_sync", idArg: url, sheet: "Sheet1", target: "B3" },
    });
  });

  it("parses sheet names containing spaces and Japanese", () => {
    expect(parseInlineCall(`spread_sync("1ABC", "施策 集計", "B3")`).ok).toBe(true);
  });

  it("parses @alias", () => {
    expect(parseInlineCall(`spread_sync("@kpi", "Sheet1", "B3")`)).toEqual({
      ok: true,
      call: { fn: "spread_sync", idArg: "@kpi", sheet: "Sheet1", target: "B3" },
    });
  });

  it("rejects too few arguments", () => {
    expect(parseInlineCall(`spread_sync("1ABC", "Sheet1")`).ok).toBe(false);
  });

  it("rejects wrong function name", () => {
    expect(parseInlineCall(`other_fn("1ABC", "Sheet1", "B3")`).ok).toBe(false);
  });

  it("returns null on completely unrelated text", () => {
    expect(parseInlineCall(`hello world`).ok).toBe(false);
  });
});

describe("parseSyncBlock", () => {
  it("parses with range", () => {
    const yaml = `id: 1ABC\nsheet: Sheet1\nrange: A1:D10`;
    expect(parseSyncBlock(yaml)).toEqual({
      ok: true,
      block: { idArg: "1ABC", sheet: "Sheet1", range: "A1:D10", named: null, whole: false, header: true, transpose: false, editable: false },
    });
  });

  it("parses with named range", () => {
    const yaml = `id: 1ABC\nsheet: Sheet1\nnamed: MonthlyKPI`;
    expect(parseSyncBlock(yaml).ok).toBe(true);
  });

  it("parses whole sheet (no range/named)", () => {
    const yaml = `id: 1ABC\nsheet: Sheet1`;
    const result = parseSyncBlock(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.block.whole).toBe(true);
  });

  it("respects header: false and transpose: true", () => {
    const yaml = `id: 1ABC\nsheet: Sheet1\nrange: A1:B2\nheader: false\ntranspose: true`;
    const r = parseSyncBlock(yaml);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.block.header).toBe(false);
      expect(r.block.transpose).toBe(true);
    }
  });

  it("rejects when both range and named are set", () => {
    const yaml = `id: 1ABC\nsheet: Sheet1\nrange: A1:D10\nnamed: Foo`;
    expect(parseSyncBlock(yaml).ok).toBe(false);
  });

  it("rejects missing id or sheet", () => {
    expect(parseSyncBlock(`sheet: Sheet1`).ok).toBe(false);
    expect(parseSyncBlock(`id: 1ABC`).ok).toBe(false);
  });
});

describe("parseWriteBlock", () => {
  it("parses single value write", () => {
    const yaml = `id: 1ABC\nsheet: Sheet1\ntarget: B3\nvalue: 42`;
    const r = parseWriteBlock(yaml);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.block).toMatchObject({
        idArg: "1ABC", sheet: "Sheet1", target: "B3", value: 42, mode: "replace",
      });
    }
  });

  it("parses array value for range write", () => {
    const yaml = `id: 1ABC\nsheet: Sheet1\ntarget: A1:B2\nvalue:\n  - [1, 2]\n  - [3, 4]`;
    const r = parseWriteBlock(yaml);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.block.value).toEqual([[1, 2], [3, 4]]);
  });

  it("respects mode: append", () => {
    const yaml = `id: 1ABC\nsheet: Sheet1\ntarget: A1\nvalue: 99\nmode: append`;
    const r = parseWriteBlock(yaml);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.block.mode).toBe("append");
  });

  it("rejects missing required fields", () => {
    expect(parseWriteBlock(`id: 1ABC\nsheet: Sheet1\ntarget: B3`).ok).toBe(false);
  });
});
