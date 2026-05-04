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
  - **SQLite** table browser via sql.js — list tables, paginate rows, run ad-hoc SELECT
  - Hex+ASCII view for everything else, virtualized for large files
- **Quick Open palette** (⌘P) — fuzzy search across every OPFS file
- **Stats treemap** — see what's eating your OPFS quota by directory and file type
- **Snapshot / restore** — export the whole OPFS to a `.zip`, restore from a `.zip`
- **Live watch** — poll for OPFS changes and flash modified files
- **DevTools theme sync** — light/dark follows your DevTools theme
- **Drag-out to download**, drag-in to upload, full IDE-style keyboard support
- Per-origin **quota bar** + status footer

## Build & install (unpacked)

```bash
pnpm install
pnpm build
```

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
