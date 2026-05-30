import { AliasMap } from "../settings/types";

export type ResolveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const URL_RE = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;
const ID_RE = /^[a-zA-Z0-9_-]{10,}$/;

export function resolveSpreadsheetId(input: string, aliases: AliasMap): ResolveResult {
  if (!input) return { ok: false, error: "Empty spreadsheet id" };

  if (input.startsWith("@")) {
    const aliasName = input.slice(1);
    const id = aliases[aliasName];
    return id ? { ok: true, id } : { ok: false, error: `Unknown alias: @${aliasName}` };
  }

  if (input.startsWith("http")) {
    const m = input.match(URL_RE);
    return m ? { ok: true, id: m[1] } : { ok: false, error: `Cannot extract spreadsheet id from URL: ${input}` };
  }

  if (ID_RE.test(input)) return { ok: true, id: input };

  return { ok: false, error: `Not a valid spreadsheet id, URL, or alias: ${input}` };
}
