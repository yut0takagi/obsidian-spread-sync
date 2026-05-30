import { describe, it, expect } from "vitest";
import { resolveSpreadsheetId } from "../src/renderer/idResolver";

describe("resolveSpreadsheetId", () => {
  const aliases = { "kpi-dashboard": "1ABCDEF1234" };

  it("returns plain id unchanged", () => {
    expect(resolveSpreadsheetId("1ABCDEF1234", aliases))
      .toEqual({ ok: true, id: "1ABCDEF1234" });
  });

  it("extracts id from /spreadsheets/d/<id>/edit URL", () => {
    const url = "https://docs.google.com/spreadsheets/d/1ABCDEF1234/edit#gid=0";
    expect(resolveSpreadsheetId(url, aliases))
      .toEqual({ ok: true, id: "1ABCDEF1234" });
  });

  it("resolves @alias", () => {
    expect(resolveSpreadsheetId("@kpi-dashboard", aliases))
      .toEqual({ ok: true, id: "1ABCDEF1234" });
  });

  it("returns error for unknown alias", () => {
    expect(resolveSpreadsheetId("@unknown", aliases))
      .toEqual({ ok: false, error: "Unknown alias: @unknown" });
  });

  it("returns error for malformed URL", () => {
    expect(resolveSpreadsheetId("https://example.com/x", aliases).ok).toBe(false);
  });

  it("returns error for empty input", () => {
    expect(resolveSpreadsheetId("", aliases))
      .toEqual({ ok: false, error: "Empty spreadsheet id" });
  });

  it("rejects obviously-short garbage id", () => {
    expect(resolveSpreadsheetId("abc", aliases).ok).toBe(false);
  });
});
