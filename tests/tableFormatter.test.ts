import { describe, it, expect } from "vitest";
import { toMarkdownTable } from "../src/renderer/tableFormatter";

describe("toMarkdownTable", () => {
  it("renders with header", () => {
    const md = toMarkdownTable([["店舗", "売上"], ["A", 100], ["B", 200]], { header: true });
    expect(md).toBe(
      "| 店舗 | 売上 |\n| --- | --- |\n| A | 100 |\n| B | 200 |\n"
    );
  });

  it("renders without header (synthetic col1/col2)", () => {
    const md = toMarkdownTable([["A", 100], ["B", 200]], { header: false });
    expect(md.startsWith("| col1 | col2 |")).toBe(true);
  });

  it("transposes when requested", () => {
    const md = toMarkdownTable([["a", 1], ["b", 2], ["c", 3]], { header: false, transpose: true });
    expect(md).toContain("| a | b | c |");
    expect(md).toContain("| 1 | 2 | 3 |");
  });

  it("escapes pipes in cell content", () => {
    const md = toMarkdownTable([["x|y"]], { header: false });
    expect(md).toContain("x\\|y");
  });

  it("returns empty string for empty input", () => {
    expect(toMarkdownTable([], { header: true })).toBe("");
  });

  it("normalizes ragged rows by padding with empty", () => {
    const md = toMarkdownTable([["a", "b"], ["c"]], { header: true });
    expect(md).toContain("| c |  |");
  });
});
