export interface FormatOpts {
  header: boolean;
  transpose?: boolean;
}

export function toMarkdownTable(rows: unknown[][], opts: FormatOpts): string {
  if (!rows.length) return "";
  let data = rows.map((r) => r.slice());
  if (opts.transpose) {
    const cols = Math.max(...data.map((r) => r.length));
    const t: unknown[][] = [];
    for (let c = 0; c < cols; c++) {
      const row: unknown[] = [];
      for (let r = 0; r < data.length; r++) row.push(data[r][c] ?? "");
      t.push(row);
    }
    data = t;
  }
  const width = Math.max(...data.map((r) => r.length));
  data = data.map((r) => {
    const out = r.slice();
    while (out.length < width) out.push("");
    return out;
  });

  let header: unknown[];
  let body: unknown[][];
  if (opts.header) {
    header = data[0];
    body = data.slice(1);
  } else {
    header = Array.from({ length: width }, (_, i) => `col${i + 1}`);
    body = data;
  }

  const esc = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const headerRow = "| " + header.map(esc).join(" | ") + " |";
  const sep = "| " + header.map(() => "---").join(" | ") + " |";
  const bodyRows = body.map((r) => "| " + r.map(esc).join(" | ") + " |");
  return [headerRow, sep, ...bodyRows].join("\n") + "\n";
}
