# Spread Sync

Embed Google Sheets cells and ranges directly into your Obsidian notes, edit them inline, and push changes back to Sheets — all with on-open auto-fetch, conflict-aware writes, and OAuth (PKCE) sign-in.

## Features

- **Inline cell read**: `` `spread_sync("<id>", "<sheet>", "B3")` `` → rendered as the cell value in Reading View.
- **Range / sheet read**: ` ```spread-sync ``` ` code block → rendered as a Markdown table.
- **In-place editing**: add `editable: true` to a `spread-sync` block → cells become editable, dirty cells highlighted, a "Push changes (N)" button writes everything back via Sheets `values:batchUpdate`.
- **Explicit write block**: ` ```spread-write ``` ` block + `Spread Sync: Push this block` command for one-shot writes.
- **Conflict detection** via Drive `modifiedTime` — overwrite/cancel dialog when the sheet was changed externally.
- **PKCE OAuth** + `safeStorage`-encrypted refresh token (Desktop only).
- **LRU cache** with stale-while-revalidate and manual refresh commands.
- **Aliases** for spreadsheet IDs so you can move sheets without grep-replacing notes.
- **429 retry** with exponential backoff.

## Install

This plugin is not (yet) in the Community Plugins directory. Install manually:

```bash
cd /path/to/your/vault/.obsidian/plugins
git clone https://github.com/yut0takagi/obsidian-spread-sync.git spread-sync
cd spread-sync
npm install
npm run build
```

Then in Obsidian: **Settings → Community plugins → enable Spread Sync**.

## Setup (5 min)

Spread Sync uses **your own Google Cloud OAuth credentials** so you control the token scopes and quota.

### 1. Create a Google Cloud project + OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. **APIs & Services → Library**: enable
   - Google Sheets API
   - Google Drive API
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - Add scopes: `.../auth/spreadsheets` and `.../auth/drive.metadata.readonly`
   - Publishing status: **In production** (avoids the 7-day refresh token expiry of "Testing" mode)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**
   - Copy both the **Client ID** and **Client secret**

> Note: Google's docs explicitly say Desktop OAuth client secrets are not actually confidential ([source](https://developers.google.com/identity/protocols/oauth2/native-app)). The plugin stores them in your local Obsidian settings.

### 2. Enter the credentials in Obsidian

Settings → Spread Sync → **OAuth credentials**: paste Client ID + Client secret.

### 3. Sign in

Same tab → **Sign in with Google** → browser opens → grant consent → "Signed in" appears.

## Usage

### Inline cell (single value)

```markdown
The current store count is `spread_sync("<spreadsheet-id>", "Sheet1", "B3")`.
```

### Range as a table

````markdown
```spread-sync
id: <spreadsheet-id>
sheet: Sheet1
range: A1:D10
header: true        # optional, default true
transpose: false    # optional, default false
```
````

### Editable table

````markdown
```spread-sync
id: <spreadsheet-id>
sheet: Sheet1
range: A1:D10
editable: true
```
````

Click any cell to edit. Dirty cells highlight in yellow. "Push changes (N)" button at the bottom batchUpdates them all to Sheets in one request. Conflict detection prompts you if the sheet was modified externally since the last fetch.

### Whole sheet

````markdown
```spread-sync
id: <spreadsheet-id>
sheet: Sheet1
```
````

### Named range

````markdown
```spread-sync
id: <spreadsheet-id>
sheet: Sheet1
named: MonthlyKPI
```
````

### Aliases

Set `kpi → <long-spreadsheet-id>` in settings, then:

````markdown
```spread-sync
id: "@kpi"
sheet: Sheet1
range: A1:C5
```
````

### Explicit write (one-shot)

````markdown
```spread-write
id: <spreadsheet-id>
sheet: Sheet1
target: B3
value: 42
mode: replace       # or "append"
```
````

Place cursor inside the block → Command Palette → **Spread Sync: Push this block**.

For range writes:

```yaml
target: A1:B2
value:
  - [1, 2]
  - [3, 4]
```

## Commands

| Command | Description |
|---|---|
| Spread Sync: Refresh current file | Invalidate cache for the active file, force re-fetch |
| Spread Sync: Refresh all open files | Same, for every open markdown leaf |
| Spread Sync: Refresh by spreadsheet | Prompt for an id / URL / @alias and invalidate all its cache entries |
| Spread Sync: Push this block | Send the current `spread-write` block to Sheets |

## Error badges

| Badge | Meaning |
|---|---|
| ⚠ re-auth | Token expired / not signed in (click to re-sign-in) |
| ⚠ no access | 403 / 404 from Sheets — check sharing or API enablement |
| ⚠ Excel format | Sheet is a `.xlsx` file uploaded to Drive. Convert to native Google Sheets first (File → Save as Google Sheets) |
| ⚠ syntax error | Block YAML / inline call is malformed (tooltip shows the parser error) |
| ⚠ range error | Inline syntax received a multi-cell range or invalid range for editable |
| ⚠ fetch failed | Generic API error — hover for full message |
| ⚠ stale Nm | Last fetch failed; showing cached value N minutes old |
| ⚠ offline | Network is down |

## Limitations

- Desktop only (uses Electron `safeStorage`).
- `editable: true` only works with literal `range:` like `A1:B2` (not `named:` or whole sheet, not `transpose: true`).
- No batchGet wiring yet — each inline expression is a separate API request (Phase 2).
- `Push this block` uses `editor.setValue` which resets cursor/undo history (Phase 2: switch to `replaceRange`).

## Development

```bash
npm install
npm run dev     # esbuild watch mode
npm test        # vitest run
```

Tests cover parser / id resolver / cache / Sheets client (with `nock`) / Drive client / OAuth client (PKCE + token exchange) / TokenStore / tableFormatter. Renderer / commands / settings UI are verified manually in a real Obsidian vault.

## Architecture

Four isolated layers:

- **Auth**: `OAuthClient` (PKCE flow), `TokenStore` (`safeStorage` wrapper), `AuthService` (orchestration + localhost loopback server for the OAuth redirect).
- **Sheets / Drive Clients**: pure HTTP wrappers using `https.request`. Read / batchRead / write / batchWrite / modifiedTime, with 429 backoff.
- **Renderer**: `parseInlineCall` + `parseSyncBlock` + `parseWriteBlock`, `resolveSpreadsheetId`, Markdown post-processors, editable table widget.
- **Storage**: `CacheStore` (LRU + debounced `saveData` persist).

## License

MIT — see [LICENSE](LICENSE).
