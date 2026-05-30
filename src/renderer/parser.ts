export interface InlineCall {
  fn: "spread_sync";
  idArg: string;
  sheet: string;
  target: string; // cell or named range
}

export type ParseInlineResult =
  | { ok: true; call: InlineCall }
  | { ok: false; error: string };

const INLINE_RE = /^spread_sync\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)\s*$/;

export function parseInlineCall(input: string): ParseInlineResult {
  const trimmed = input.trim();
  const m = trimmed.match(INLINE_RE);
  if (!m) {
    if (/^spread_sync\(/.test(trimmed)) {
      return { ok: false, error: "spread_sync requires 3 string arguments: (id, sheet, target)" };
    }
    return { ok: false, error: "not a spread_sync call" };
  }
  return {
    ok: true,
    call: {
      fn: "spread_sync",
      idArg: m[1].replace(/\\"/g, '"'),
      sheet: m[2].replace(/\\"/g, '"'),
      target: m[3].replace(/\\"/g, '"'),
    },
  };
}

export interface SyncBlock {
  idArg: string;
  sheet: string;
  range: string | null;
  named: string | null;
  whole: boolean;
  header: boolean;
  transpose: boolean;
  editable: boolean;
}

export interface WriteBlock {
  idArg: string;
  sheet: string;
  target: string;
  value: unknown;
  mode: "replace" | "append";
}

export type ParseBlockResult<T> =
  | { ok: true; block: T }
  | { ok: false; error: string };

function parseFlatYaml(input: string): Record<string, unknown> {
  const lines = input.split(/\r?\n/);
  const out: Record<string, unknown> = {};
  let listKey: string | null = null;
  const listRows: unknown[][] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (listKey) {
      const m = line.match(/^\s*-\s*\[(.*)\]\s*$/);
      if (m) {
        listRows.push(m[1].split(",").map((s) => coerce(s.trim())));
        continue;
      }
      out[listKey] = listRows.slice();
      listKey = null;
      listRows.length = 0;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const rawVal = kv[2];
    if (rawVal === "") {
      listKey = key;
    } else {
      out[key] = coerce(rawVal);
    }
  }
  if (listKey) out[listKey] = listRows.slice();
  return out;
}

function coerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  return raw.replace(/^"(.*)"$/, "$1");
}

export function parseSyncBlock(input: string): ParseBlockResult<SyncBlock> {
  const obj = parseFlatYaml(input);
  const id = obj.id as string | undefined;
  const sheet = obj.sheet as string | undefined;
  if (!id) return { ok: false, error: "missing required field: id" };
  if (!sheet) return { ok: false, error: "missing required field: sheet" };
  const range = (obj.range as string | undefined) ?? null;
  const named = (obj.named as string | undefined) ?? null;
  if (range && named) return { ok: false, error: "specify either `range` or `named`, not both" };
  return {
    ok: true,
    block: {
      idArg: id,
      sheet,
      range,
      named,
      whole: !range && !named,
      header: obj.header !== false,
      transpose: obj.transpose === true,
      editable: obj.editable === true,
    },
  };
}

export function parseWriteBlock(input: string): ParseBlockResult<WriteBlock> {
  const obj = parseFlatYaml(input);
  const id = obj.id as string | undefined;
  const sheet = obj.sheet as string | undefined;
  const target = obj.target as string | undefined;
  if (!id || !sheet || !target) return { ok: false, error: "id, sheet, target are required" };
  if (!("value" in obj)) return { ok: false, error: "value is required" };
  const mode = (obj.mode as string | undefined) ?? "replace";
  if (mode !== "replace" && mode !== "append") return { ok: false, error: `invalid mode: ${mode}` };
  return {
    ok: true,
    block: { idArg: id, sheet, target, value: obj.value, mode },
  };
}
