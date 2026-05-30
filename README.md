<div align="center">

# 📊  Spread Sync

### Your Google Sheet, inside your Obsidian note.

Embed sheet cells inline. Render ranges as tables. Edit them in place. Push back. All with conflict-aware writes and PKCE OAuth.

[![License: MIT](https://img.shields.io/badge/License-MIT-7c3aed.svg)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.4+-7c3aed)](https://obsidian.md)
[![Desktop only](https://img.shields.io/badge/Desktop-only-94a3b8)](#requirements)
[![Tests](https://img.shields.io/badge/tests-59%20passing-34d399)](#development)
[![Docs](https://img.shields.io/badge/docs-github.io-7c3aed)](https://yut0takagi.github.io/obsidian-spread-sync/)

[**📖 Docs**](https://yut0takagi.github.io/obsidian-spread-sync/) · [**🚀 Install**](#install) · [**⚙️ Setup**](#setup-5-min) · [**💡 Usage**](#usage)

</div>

---

## ✨ What it does

| | |
|---|---|
| 🔢 **Inline cell** | `` `spread_sync("id", "Sheet1", "B3")` `` → renders as the live value |
| 📋 **Range table** | ` ```spread-sync ``` ` block → Markdown table, headers/transpose/named ranges supported |
| ✏️ **Edit in place** | Add `editable: true` → cells become editable, one button batchUpdates all changes |
| ✍️ **Explicit write** | ` ```spread-write ``` ` block + `Push this block` command |
| 🛡️ **Conflict-aware** | Drive `modifiedTime` check before every push, Overwrite/Cancel prompt on mismatch |
| 🔐 **PKCE OAuth** | Bring your own Google Cloud Desktop client. Refresh token encrypted via `safeStorage` |
| ⚡ **Smart caching** | LRU + debounced persist, stale-while-revalidate, manual refresh commands |
| 🌐 **Resilient** | 429 backoff, offline-aware, dedicated error badges (`no access`, `Excel format`, etc.) |

## 🚀 Install

```bash
cd /path/to/your/vault/.obsidian/plugins
git clone https://github.com/yut0takagi/obsidian-spread-sync.git spread-sync
cd spread-sync && npm install && npm run build
```

Then in Obsidian: **Settings → Community plugins → enable Spread Sync**.

## ⚙️ Setup (5 min)

Spread Sync uses **your own** Google Cloud OAuth credentials. You stay in control of scopes and quota.

<details>
<summary><b>Step 1 — Create a Google Cloud project</b></summary>

Open [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
</details>

<details>
<summary><b>Step 2 — Enable APIs</b></summary>

APIs &amp; Services → Library → enable:
- Google Sheets API
- Google Drive API
</details>

<details>
<summary><b>Step 3 — Configure OAuth consent screen</b></summary>

- User type: **External**
- Add scopes: `.../auth/spreadsheets` + `.../auth/drive.metadata.readonly`
- Publishing status: **In production** (avoids the 7-day refresh-token expiry of "Testing" mode)
</details>

<details>
<summary><b>Step 4 — Create OAuth client</b></summary>

Credentials → Create credentials → OAuth client ID → Application type: **Desktop app**. Copy both **Client ID** and **Client secret**.

> Note: Google's docs explicitly say Desktop OAuth client secrets are not actually confidential ([source](https://developers.google.com/identity/protocols/oauth2/native-app)). Storing it in your local Obsidian settings is consistent with how the official Google libraries handle it.
</details>

<details>
<summary><b>Step 5 — Paste into Obsidian</b></summary>

Settings → Spread Sync → **OAuth credentials** section. Paste both values. Click **Sign in with Google**. Done.
</details>

## 💡 Usage

### Inline cell

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

### Editable table ✨

````markdown
```spread-sync
id: <spreadsheet-id>
sheet: Sheet1
range: A1:D10
editable: true
```
````

<table>
<tr>
<td><b>Click any cell</b> to edit.</td>
<td>Dirty cells <b>highlight yellow</b>.</td>
<td><b>Push button</b> at the bottom batches all dirty cells into one <code>values:batchUpdate</code>.</td>
</tr>
</table>

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

Set `kpi → <long-spreadsheet-id>` in settings, then reference as `"@kpi"`:

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

## 🎛️ Commands

| Command | Description |
|---|---|
| `Spread Sync: Refresh current file` | Invalidate cache for the active file, force re-fetch |
| `Spread Sync: Refresh all open files` | Same, for every open markdown leaf |
| `Spread Sync: Refresh by spreadsheet` | Prompt for an id / URL / @alias and invalidate all its cache |
| `Spread Sync: Push this block` | Send the current `spread-write` block to Sheets |

## 🚨 Error badges

| Badge | Meaning |
|---|---|
| `⚠ re-auth` | Token expired / not signed in — click to re-sign-in |
| `⚠ no access` | 403 / 404 from Sheets — check sharing or API enablement |
| `⚠ Excel format` | Sheet is a `.xlsx` uploaded to Drive — convert to native Google Sheets |
| `⚠ syntax error` | Block YAML / inline call is malformed (tooltip shows the parser error) |
| `⚠ range error` | Inline syntax got a multi-cell range, or editable got an invalid range |
| `⚠ fetch failed` | Generic API error — hover for full message |
| `⚠ stale Nm` | Last fetch failed; showing cached value N minutes old |
| `⚠ offline` | Network is down |

## 🏗️ Architecture

Four isolated layers:

```
┌──────────────────────────────────────────────┐
│  Renderer   inline / block postprocessors    │
│             editable table widget            │
├──────────────────────────────────────────────┤
│  Auth       OAuth (PKCE) · safeStorage       │
│             localhost loopback callback      │
├──────────────────────────────────────────────┤
│  Sheets+Drive   pure HTTP (https.request)    │
│                read · batchRead · write      │
│                batchWrite · modifiedTime     │
│                429 backoff                   │
├──────────────────────────────────────────────┤
│  Storage    LRU cache · debounced persist    │
└──────────────────────────────────────────────┘
```

## 📋 Requirements

- Obsidian **1.4+**
- **Desktop only** (Electron `safeStorage` not available on mobile)
- Node **18+** for build

## 🚧 Limitations

- `editable: true` only works with literal `range:` like `A1:B2` (not `named:` or whole sheet, not `transpose: true`).
- No batchGet wiring yet — each inline expression is a separate API request *(Phase 2)*.
- `Push this block` uses `editor.setValue` which resets cursor/undo history *(Phase 2: replace with `replaceRange`)*.

## 🧪 Development

```bash
npm install
npm run dev     # esbuild watch mode
npm test        # vitest run — 59 tests across 8 files
```

Tests cover: parser, id resolver, cache, Sheets client (with `nock`), Drive client, OAuth client (PKCE + token exchange), TokenStore, table formatter. Renderer / commands / settings UI are verified manually in a real Obsidian vault.

## 📄 License

[MIT](LICENSE) — built by [@yut0takagi](https://github.com/yut0takagi).
