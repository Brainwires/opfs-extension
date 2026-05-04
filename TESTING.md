# Manual QA checklist

Most of the original 80-item checklist is now automated. Run `pnpm test` first —
it covers everything that doesn't require a live DevTools panel + a human's eyes.

## What's already automated (don't bother manually)

- **42 unit tests** (`pnpm test:unit`) — magic-byte sniffing, hexdump rows, formatBytes,
  base64 round-trip, all Zustand store reducers (tabs, selection, view mode, dirty
  tracking, palette/sheet flags).
- **20 bridge integration tests** (`pnpm test:bridge`) — runs the real bridge installer
  in headless Chromium against a live OPFS root. Covers: every RPC op (`list/read/write/
  mkdir/rm/move/quota/stat/mtimes/tree`), chunked binary integrity for >4 MB payloads
  (verified via SHA-256), append mode, Unicode paths, NotFound surfacing, refusal to
  remove root, idempotent reinstallation, and **lock detection via real
  SyncAccessHandle** held by a worker.
- **18 dist validators** (`pnpm validate:dist`) — manifest is MV3, has `devtools_page`,
  has zero broad permissions, every icon resolves, every HTML asset reference resolves,
  the panel chunk inlines the bridge installer.

If `pnpm test` is green, the bridge, the RPC, the data path, and the manifest are all
verified. The list below is **only** what those automated tests genuinely can't reach.

---

## Manual checklist (requires a real browser + DevTools panel + a human)

### A. Installation

- [ ] **A.1** `pnpm build && open chrome://extensions` → Developer mode on → **Load unpacked** → pick `dist/`. Card shows "Brainwires OPFS" with the gradient folder icon.
- [ ] **A.2** Open DevTools on any normal http(s) page. The **OPFS** tab appears alongside Elements/Console.

### B. The "OPFS" panel renders

- [ ] **B.1** Switch to the OPFS panel. Layout matches the design: top toolbar, left tree pane (resizable handle), right content pane, bottom status bar.
- [ ] **B.2** Resizing the left/right split via the handle works smoothly.
- [ ] **B.3** Empty / disconnected states look right:
  - On a `chrome://newtab/` style page → "OPFS isn't reachable from this page".
  - On a normal page that's never used OPFS → empty-OPFS state with the origin shown.
  - Without an open tab → "No file selected" with the ⌘P hint.

### C. Live OPFS data renders

Open `chrome-extension://<id>/test-fixture.html` in a tab, click **Seed OPFS**, then
open DevTools → OPFS panel.

- [ ] **C.1** Tree shows `data/`, `db/`, `nested/`, `hello.txt`, `image.png`, `sample.json`. Click directories — they expand/collapse. Filter input narrows results.
- [ ] **C.2** Status bar quota progress is visible and non-zero; origin (`chrome-extension://<id>`) shows on the right.

### D. Type-aware viewers (visual rendering)

- [ ] **D.1** `hello.txt` opens in CodeMirror with line numbers and syntax highlighting tied to extension.
- [ ] **D.2** `data/notes.md` highlights as Markdown.
- [ ] **D.3** `sample.json` is pretty-printed with JSON syntax highlighting.
- [ ] **D.4** `image.png` renders as image, footer shows `image/png · 64 × 64 · <size>`.
- [ ] **D.5** Drop a `.mp3`/`.mp4` onto the tree → opens with `<audio>`/`<video>` controls and plays.
- [ ] **D.6** Drop a `.pdf` → "Rendering PDF…" then page canvases stack.
- [ ] **D.7** Drop a real `.sqlite` (eg. `sqlite3 t.db 'CREATE TABLE u(id,name); INSERT u VALUES(1,"a");'`) → SQLite viewer shows tables left, rows right; pagination controls work; ad-hoc SELECT runs.
- [ ] **D.8** Open `large.bin` after clicking **Add 5 MB blob** → hex+ASCII view scrolls smoothly to the end.
- [ ] **D.9** On a text file, the viewer header **text/hex** toggle switches views.

### E. Editor save flow (the part the bridge tests can't see)

- [ ] **E.1** Edit `hello.txt` → tab badge shows dirty dot, status bar shows `● modified`, "Save (⌘S)" button appears in viewer header.
- [ ] **E.2** Press ⌘S → marker clears. Refresh the panel (toolbar refresh) → edit persisted.

### F. Drag & drop UX

- [ ] **F.1** Drag any OS file onto the root of the tree → uploads. Toast shows count.
- [ ] **F.2** Drag onto a specific directory → uploads into that directory.
- [ ] **F.3** Drag a tree node out onto the desktop → file downloads (browser save-as may prompt).

### G. Toolbar actions

- [ ] **G.1** + file → prompt → file appears, opens.
- [ ] **G.2** + folder → directory appears expanded.
- [ ] **G.3** Upload (⤒) icon → file picker → multi-select uploads work.
- [ ] **G.4** Export OPFS as .zip → downloads; opening the zip shows the entire tree with correct structure.
- [ ] **G.5** Restore from .zip → wipe OPFS first (fixture button), then restore the just-downloaded zip → tree repopulates.
- [ ] **G.6** Live watch toggle → flip on; in the fixture tab click **Seed OPFS** again → within ~2s panel tree refreshes and changed entries flash blue.
- [ ] **G.7** Refresh icon reloads everything.

### H. Context menu + inline edit

- [ ] **H.1** Right-click a file → Download / Duplicate / Rename… / Delete (Delete is destructive-styled).
- [ ] **H.2** Right-click a directory → Rename / Delete (Delete prompts about recursive removal).
- [ ] **H.3** Inline rename succeeds; tree updates without losing selection.

### I. Lock badge (visual side of automated lock detection)

- [ ] **I.1** Click **Lock /db/lockable.bin** in the fixture; refresh the panel; the file shows a lock icon (amber) next to the name.
- [ ] **I.2** Try to delete or rename the locked file → toast error mentions it's locked. Tree state stays consistent.
- [ ] **I.3** Click **Unlock** in the fixture; on next refresh (or live watch tick) lock badge clears.

### J. Stats treemap

- [ ] **J.1** Toolbar HardDrive icon → switches to Stats view.
- [ ] **J.2** Treemap renders, big rectangles for big files (`large.bin` should dominate after **Add 5 MB blob**).
- [ ] **J.3** Hover any rectangle → header shows `path — size`. Click → switches back to Tree, selects the file, opens it.

### K. Status bar accuracy

- [ ] **K.1** Quota progress + `usage / quota` + `%` update after upload/delete.
- [ ] **K.2** File count + dir count match the tree.
- [ ] **K.3** Active tab's size shows on the right; dirty marker appears while editing.

### L. Theme sync

- [ ] **L.1** DevTools → ⋮ → **Settings** → toggle Dark/Light. The OPFS panel re-themes within a moment, including syntax highlighting and toasts.

### M. Keyboard shortcuts

Hit **?** anywhere outside a text input to show the sheet, then exercise:

- [ ] **M.1** ⌘P → palette opens, fuzzy filter works, Enter opens the file
- [ ] **M.2** ⌘S → save (only when dirty)
- [ ] **M.3** ⌘W → closes active tab
- [ ] **M.4** ⌘N → new file in current dir
- [ ] **M.5** ⇧⌘N → new directory
- [ ] **M.6** F2 → rename selected
- [ ] **M.7** Delete → delete with confirm
- [ ] **M.8** ↑ / ↓ / → / ← / Enter → tree navigation works
- [ ] **M.9** ? → toggles the sheet
- [ ] **M.10** ⌘. → toggles live watch (toolbar icon flips)

### N. Multi-origin

- [ ] **N.1** Open OPFS panel on the fixture (`chrome-extension://...`) → see fixture files.
- [ ] **N.2** In the same DevTools window, navigate the inspected page to a different origin (e.g. `https://example.com`) → tree refreshes, status-bar origin updates, panel shows that origin's OPFS.

### O. Real SQLite-Wasm in the wild

- [ ] **O.1** Open `https://sqlite.org/wasm/demo-123.html` (or any live OPFS-Wasm app you use). Click Run on a demo to trigger writes.
- [ ] **O.2** OPFS panel shows the database file. Open it → real schema and rows appear in the SQLite browser.
- [ ] **O.3** During an active write, the file may show the lock badge (depending on whether the page holds a `SyncAccessHandle` open).

### P. Web Store dry-run

- [ ] **P.1** `pnpm package` → `brainwires-opfs.zip` ~1.2 MB at repo root.
- [ ] **P.2** Upload to a *draft* listing in the Chrome Web Store dev dashboard. Walk through the privacy form: data collection = none; single purpose = OPFS file management in DevTools.
- [ ] **P.3** No reviewer-blocking flags raised (no broad host permissions, no remote code, no unjustified `<all_urls>`).

---

If anything in **A–O** fails, file an issue with the section letter, the browser
version, and any console output. If a manual finding suggests a regression we *should*
have caught automatically, please add a corresponding test to `tests/unit/` or
`tests/bridge/` so it can't slip past again.
