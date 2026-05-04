# Brainwires OPFS

A Chrome DevTools extension for browsing, editing, uploading, and exporting files in any
origin's [Origin Private File System](https://web.dev/articles/origin-private-file-system).

## Why

Existing OPFS-management extensions in the Chrome Web Store either look stale, don't show
file contents, can't write to OPFS, or come from authors you don't recognize. This is built
greenfield with **no telemetry, no remote code, no broad host permissions** — just a
DevTools panel.

## Features

- **File tree** with expand/collapse, lazy load, lock badges, drag-drop upload
- **Tabbed viewer** — open multiple OPFS files at once
- **Type-aware viewers** picked from magic bytes:
  - Text + JSON with **CodeMirror 6 editor** and ⌘S to save
  - Image (PNG/JPG/GIF/WebP/SVG) and audio/video previews
  - **PDF** rendering via pdfjs
  - **SQLite** IDE: schema browser (tables/columns/PKs/FKs/indexes/pragmas),
    paginated data grid with FK click-through, SQL console with autocomplete +
    history + saved queries, EXPLAIN, CSV/JSON/SQL-INSERT export. Powered by
    [rsqlite-wasm](https://github.com/Brainwires/rsqlite-wasm). **Live-edit mode**
    when the inspected app calls `exposeForDevtools(db)` — writes route through
    the page's own engine, no OPFS lock conflict, auto-refresh on the page's
    own writes (see [Live editing](#live-editing) below).
  - **Multipart group recognition** — rsqlite-wasm's `db.000`, `.001`, … shards
    show as one virtual row in the tree; expanding reveals individual shards.
  - Hex+ASCII view for everything else, virtualized for large files
- **Quick Open palette** (⌘P) — fuzzy search across every OPFS file
- **Stats treemap** — see what's eating your OPFS quota by directory and file type
- **Snapshot / restore** — export the whole OPFS to a `.zip`, restore from a `.zip`
- **Live watch** — poll for OPFS changes and flash modified files
- **DevTools theme sync** — light/dark follows your DevTools theme
- **Drag-out to download**, drag-in to upload, full IDE-style keyboard support
- Per-origin **quota bar** + status footer

## Install (no Web Store, no clone)

```bash
npx brainwires-opfs            # extract + print Load unpacked instructions
npx brainwires-opfs --launch   # also opens chrome://extensions automatically
```

The npm package ships the prebuilt extension. No git clone, no Rust toolchain, no build
required on the consumer machine. See [`cli/README.md`](cli/README.md) for the full CLI
docs (custom paths, JSON output, uninstall, browser auto-detection).

## Build from source

The SQLite client is powered by [rsqlite-wasm](https://github.com/Brainwires/rsqlite-wasm),
vendored as a git submodule under `vendor/rsqlite-wasm/`.

**Prerequisites:** Node 22+, pnpm 10+, [Rust + wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
on PATH.

```bash
git clone https://github.com/Brainwires/opfs-extension.git
cd opfs-extension
pnpm install   # preinstall hook auto-clones the submodule and builds rsqlite-wasm
pnpm build
```

The `preinstall` hook handles `git submodule update --init --recursive` and the wasm
build automatically — running just `pnpm install` is enough. You don't have to remember
`--recurse-submodules` or any setup step. If a prerequisite is missing (no Rust, no
wasm-pack) it bails with a clear fix-it message instead of pnpm's confusing
`ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`.

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Pick the generated `dist/` folder
5. Open DevTools on any page — there's now an **OPFS** panel

## Develop

```bash
pnpm dev
```

Load the extension as above, then edit any panel source — HMR will refresh the panel
while it's open.

## Test fixture

The build includes `test-fixture.html`. After loading the unpacked extension, open it
from `chrome-extension://<extension-id>/public/test-fixture.html` (or the `dist` path
shown by the `vite build` output). Click **Seed OPFS**, then open DevTools and switch to
the OPFS panel.

The fixture also has buttons to:
- Add a 5 MB random blob (exercises chunked read/write)
- Lock a file with `FileSystemSyncAccessHandle` so you can verify the lock badge
- Wipe everything

## Live editing

By default the SQLite viewer loads a *snapshot* of the database from OPFS — it
reads the bytes, instantiates a local rsqlite-wasm `Database`, and shows you
the schema and rows. Edits attempted in this mode will fail when the inspected
page is actively using the database, because OPFS `SyncAccessHandle` is
exclusive — only one writer at a time.

To get fully live editing (UPDATE/INSERT/DDL while the page is using the
database, plus auto-refresh when the page itself writes), the page opts in
with one line at startup:

```javascript
import { Database, exposeForDevtools } from 'rsqlite-wasm';

const db = await Database.open('chat', { backend: 'opfs' });
exposeForDevtools(db, { name: 'chat' });

// Or with WorkerDatabase, same call:
const db = await WorkerDatabase.open('chat');
exposeForDevtools(db, { name: 'chat' });

// Tree-shake out in production:
exposeForDevtools(db, {
  name: 'chat',
  disabled: process.env.NODE_ENV === 'production',
});
```

When `exposeForDevtools` is in place:

- The viewer's header shows a green **● live (name)** badge.
- All SQL — reads, writes, DDL — flows through the page's own `Database` via
  a `postMessage`-style bridge installed at `window.__BRAINWIRES_RSQLITE_DEVTOOLS__`.
  No second handle, no lock conflict, writes are seen by the page immediately.
- The viewer polls a `changeCounter` so when the page writes (from its own
  code), the schema and current table re-fetch automatically.
- The "Save" button becomes a no-op (writes already committed). "Export as
  .sqlite" is unavailable in live mode (use Reload from OPFS to switch to
  snapshot mode for that).

If `exposeForDevtools` isn't called, the viewer falls back to snapshot mode
silently — there's no warning, just a grey **● snapshot** badge in the header
and a hint explaining how to enable live mode.

## Permissions

`manifest.json` declares **only** `devtools_page`. No `host_permissions`, no `permissions`
list, no service worker, no content scripts. Access to the inspected page comes from the
DevTools API and is granted only while DevTools is attached.

## Architecture

The DevTools panel can't touch a page's OPFS directly — OPFS is per-origin and the panel
runs in its own privileged realm. The panel uses
`chrome.devtools.inspectedWindow.eval()` to install a tiny in-page bridge
(`src/panel/bridge/installer.js`) into the inspected page's main world. The bridge
exposes async OPFS operations via a poll-based RPC because `inspectedWindow.eval` is
sync-only.

```
panel (React, our origin)
  │ chrome.devtools.inspectedWindow.eval
  ▼
inspected page main world
  │ navigator.storage.getDirectory()
  ▼
OPFS root for the inspected origin
```

Binary file contents round-trip as base64. Files >4 MB are chunked across multiple eval
calls.

## License

[MIT](LICENSE) — see also [PRIVACY.md](PRIVACY.md).
