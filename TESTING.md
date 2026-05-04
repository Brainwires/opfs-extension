# Manual QA checklist

A walkthrough you can run end-to-end on a freshly loaded build. Roughly grouped from
"nothing works" → "everything works"; each item is one concrete action.

## 0. Build & install

- [ ] **0.1** `pnpm install && pnpm build` — completes with no TS errors.
- [ ] **0.2** `chrome://extensions` → Developer mode → **Load unpacked** → pick `dist/`. Extension card shows "Brainwires OPFS" with the gradient folder icon and version 0.1.0.
- [ ] **0.3** Open any normal http(s) page (eg. `https://example.com`) → DevTools (F12) → tabs at top show **OPFS** alongside Elements, Console, etc. Click it; the panel renders.

## 1. Empty / error states

- [ ] **1.1** With DevTools open on `https://example.com` (no OPFS used), panel shows the **EmptyOpfsState** with the origin name and the upload hint.
- [ ] **1.2** Open DevTools on a `chrome://newtab/` page → switch to OPFS panel → shows the **NoOpfsState** ("OPFS isn't reachable from this page").
- [ ] **1.3** Without selecting anything, the right pane shows **NoSelectionState** with the ⌘P hint.
- [ ] **1.4** With DevTools open, refresh the inspected page in the browser — the panel should refresh on its own (not need a manual click).

## 2. Test fixture seeding

Open `chrome-extension://<id>/test-fixture.html` in a normal tab. The id is shown on the
extension card in `chrome://extensions`.

- [ ] **2.1** Click **Seed OPFS** → log shows `Seeded ✓`.
- [ ] **2.2** Open DevTools on the fixture tab → OPFS panel → tree shows `data/`, `db/`, `nested/`, `hello.txt`, `image.png`, `sample.json`.
- [ ] **2.3** Quota bar at the bottom shows non-zero usage; origin in the status bar matches the fixture's `chrome-extension://<id>` host.

## 3. File tree

- [ ] **3.1** Click `data/` → expands; click again → collapses.
- [ ] **3.2** Type `note` in the filter box → only `data/` (or its descendants) remain.
- [ ] **3.3** Hover a file → file size appears at the right edge of the row.
- [ ] **3.4** Click `nested/` → `deep/` → `path/` → eventually `leaf.log`. Tree handles depth correctly.

## 4. Quick Open palette

- [ ] **4.1** Press **⌘P** (Ctrl+P on Linux/Win) → palette dialog opens.
- [ ] **4.2** Type `leaf` → `nested/deep/path/leaf.log` ranks first.
- [ ] **4.3** Press Enter → palette closes, tab opens, breadcrumb shows full path.
- [ ] **4.4** Reopen palette, type a directory name (e.g. `data`) → selecting it expands the directory in the tree (no tab opens).

## 5. Tabs

- [ ] **5.1** Open `hello.txt`, then `sample.json`, then `image.png` from the tree → three tabs.
- [ ] **5.2** Click between tabs — viewer updates, breadcrumb updates.
- [ ] **5.3** Hit **⌘W** with `image.png` active → tab closes, focus moves to last remaining tab.
- [ ] **5.4** Click the × on a tab → closes that tab.

## 6. Breadcrumb bar

- [ ] **6.1** With a deep file open, breadcrumb shows each segment as a button.
- [ ] **6.2** Click `/` (the leading slash) → input field appears with editable path.
- [ ] **6.3** Type a different valid path and press Enter → navigates to that file.
- [ ] **6.4** Click the **download** button on the breadcrumb → file downloads to your OS Downloads folder.

## 7. Text editor (hello.txt)

- [ ] **7.1** Open `hello.txt` → CodeMirror loads, content visible, line numbers on the left.
- [ ] **7.2** Type something → tab badge shows a dirty dot, status bar shows `● modified`, "Save (⌘S)" button appears in viewer header.
- [ ] **7.3** Press **⌘S** → toast or visible state change clears dirty marker, content persists. Refresh the panel (refresh icon in toolbar) → your edit is still there.
- [ ] **7.4** Open `data/notes.md` → renders with markdown syntax highlighting.
- [ ] **7.5** Open `data/config.toml` → renders as plain text (no TOML grammar bundled, that's expected).

## 8. JSON viewer

- [ ] **8.1** Open `sample.json` → content is pretty-printed (2-space indent), JSON syntax highlighting on.
- [ ] **8.2** Edit a value → ⌘S saves. Reload the tab → edit persisted.

## 9. Image viewer

- [ ] **9.1** Open `image.png` → image renders centered, footer shows `image/png · 64 × 64 · <size>`.
- [ ] **9.2** Drag-drop a `.jpg` from your desktop onto the root of the tree → uploads, then double-click to open → renders.

## 10. Audio / video

- [ ] **10.1** Drag any local `.mp3` onto the tree → uploads. Open it → audio player with controls. Press play.
- [ ] **10.2** Drag any small `.mp4` onto the tree → uploads. Open → video player. Press play.

## 11. PDF viewer

- [ ] **11.1** Drag a `.pdf` onto the tree → uploads. Open it → "Rendering PDF…" briefly, then page canvases appear.
- [ ] **11.2** Multi-page PDF renders all pages stacked vertically.

## 12. SQLite viewer

The fixture's `db/main.sqlite` is just the magic header — sql.js will fail to parse it
gracefully. To test the real viewer you need a real SQLite file:

- [ ] **12.1** On a machine with sqlite3, run `sqlite3 test.db 'CREATE TABLE users(id INT, name TEXT); INSERT INTO users VALUES (1, "Alice"), (2, "Bob");'` then drop `test.db` onto the OPFS tree.
- [ ] **12.2** Open it → left sidebar lists `users`. Right side shows columns and rows.
- [ ] **12.3** Pagination works (Prev/Next disabled at extremes; row counter updates).
- [ ] **12.4** Type `SELECT name FROM users WHERE id=1` in the ad-hoc box → press Run (or ⌘Enter) → result table shows "Alice".
- [ ] **12.5** Bonus: visit `https://sqlite.org/wasm/demo-123.html`, run any of their demos that write to OPFS → DevTools → OPFS panel → see their `sqlite.db` file → open it → real schema appears.

## 13. Hex viewer

- [ ] **13.1** Click **Add 5 MB random blob** in the fixture → `large.bin` appears in the tree (5.0 MB).
- [ ] **13.2** Open `large.bin` → loading spinner with progress %, then hex view renders.
- [ ] **13.3** Scroll the hex view — virtualized rows continue smoothly to the end (no lag, no blank patches).
- [ ] **13.4** Open a text file → in the viewer header click **hex** → switches to hex view of the same bytes; click **text** → switches back.

## 14. Create / rename / delete

- [ ] **14.1** Toolbar **+ file** with `/` selected → prompt → enter `foo.txt` → file appears in root, opens automatically.
- [ ] **14.2** Toolbar **+ folder** → prompt → enter `scratch` → directory appears, expanded.
- [ ] **14.3** Right-click a file → **Rename** → change name → tree updates.
- [ ] **14.4** Right-click a directory → **Rename** → recursive move works (children preserved).
- [ ] **14.5** Right-click a file → **Delete** → confirm → file gone; quota updates.
- [ ] **14.6** Right-click a directory with contents → **Delete** → recursive confirm → entire subtree gone.
- [ ] **14.7** Select root and try Delete keyboard → blocked / no-op (we refuse to remove the OPFS root).

## 15. Drag & drop

- [ ] **15.1** Drag any OS file onto a specific directory in the tree → uploads into that directory.
- [ ] **15.2** Drag multiple files at once → all upload, success toast counts them.
- [ ] **15.3** Drag a file from the OPFS tree onto your desktop → file downloads (browser may show a "Save as" prompt depending on settings).

## 16. Snapshot / restore zip

- [ ] **16.1** Toolbar **Export OPFS as .zip** (download icon) → `.zip` lands in Downloads. Open it → contains the entire tree with correct paths.
- [ ] **16.2** Click **Wipe OPFS** in the fixture → tree empties.
- [ ] **16.3** Toolbar **Restore from .zip** (rotated upload icon) → pick the zip you just downloaded → tree repopulates with the original structure.

## 17. Live watch

- [ ] **17.1** Toggle **Live watch** in the toolbar (clock → activity icon).
- [ ] **17.2** Switch to the fixture tab and click **Seed OPFS** again → within ~2s the OPFS panel's tree should refresh; modified entries flash blue briefly.
- [ ] **17.3** Toggle live watch off → polling stops (you can verify by clicking Add 5 MB blob and confirming the panel does *not* auto-refresh).

## 18. Lock detection

- [ ] **18.1** In the fixture, click **Lock /db/lockable.bin** → log says `Locked`.
- [ ] **18.2** In the OPFS panel, refresh → click `lockable.bin` to select → a lock icon should appear next to the name.
- [ ] **18.3** Try to delete or rename it → toast error mentions the file is locked / `NoModificationAllowedError`. Tree state stays sane.
- [ ] **18.4** Fixture **Unlock** → after the next tree refresh (live watch on, or hit refresh), lock badge clears.

## 19. Stats treemap

- [ ] **19.1** Toolbar storage icon (HardDrive) → switches to Stats view.
- [ ] **19.2** Treemap renders, big rectangles for big files (`large.bin` should dominate).
- [ ] **19.3** Hover any rectangle → header shows `path — size`.
- [ ] **19.4** Click a rectangle → switches back to Tree view, selects that file (and opens it if it's a file).

## 20. Status bar

- [ ] **20.1** Quota progress + `usage / quota` + `%` are visible and update after upload/delete.
- [ ] **20.2** File count + dir count match what you see in the tree.
- [ ] **20.3** Origin (e.g. `chrome-extension://<id>`) shows on the right, prefixed by a globe icon.
- [ ] **20.4** Open a tab → its size appears in the right portion of the status bar.

## 21. Theme sync

- [ ] **21.1** DevTools → ⋮ menu → **Settings** → **Preferences** → switch theme between Dark/Light.
- [ ] **21.2** OPFS panel re-themes within a moment (background, text, syntax highlighting all swap).

## 22. Keyboard shortcuts

Press **?** (with focus outside any text input) → ShortcutSheet opens. Verify each:

- [ ] **22.1** **⌘P / Ctrl+P** → Quick Open
- [ ] **22.2** **⌘S** → Save (only when dirty)
- [ ] **22.3** **⌘W** → Close active tab
- [ ] **22.4** **⌘N** → New file in the current dir
- [ ] **22.5** **⇧⌘N** → New directory
- [ ] **22.6** **F2** → Rename selected
- [ ] **22.7** **Delete** → Delete selected (with confirm)
- [ ] **22.8** **↑ / ↓** → Move tree selection
- [ ] **22.9** **→ / ←** → Expand / collapse directory
- [ ] **22.10** **Enter** → Open file or toggle directory
- [ ] **22.11** **?** → Toggle this sheet
- [ ] **22.12** **⌘.** → Toggle live watch (toolbar icon flips)

## 23. Multi-origin behavior

- [ ] **23.1** Open OPFS panel on the fixture (`chrome-extension://...`) → see fixture files.
- [ ] **23.2** In the same DevTools window, navigate the inspected page to a different origin (e.g. `https://example.com`) → tree should refresh and now show that origin's OPFS (probably empty).
- [ ] **23.3** Status bar origin updates accordingly.

## 24. Big-file chunking

- [ ] **24.1** Generate a 25 MB file: `head -c 26214400 /dev/urandom > big.bin`.
- [ ] **24.2** Drop it on the OPFS tree → upload completes (chunked through 4 MB writes).
- [ ] **24.3** Right-click → Download → bytes match: `sha256sum big.bin Downloads/big.bin` should produce identical hashes.
- [ ] **24.4** Open `big.bin` → hex view loads via chunked reads; "Reading (XX%)" indicator visible during fetch.

## 25. SQLite-Wasm in the wild

- [ ] **25.1** Open `https://sqlite.org/wasm/demo-123.html` (or any other live SQLite-Wasm app you use).
- [ ] **25.2** Run the demo's "Run" buttons to trigger writes.
- [ ] **25.3** OPFS panel → see the database file appear.
- [ ] **25.4** During an active write, the file should sometimes show the lock badge (depending on whether `SyncAccessHandle` is held open).
- [ ] **25.5** Open the `.sqlite` file → SQLite viewer shows real tables. Run a SELECT.

## 26. Web Store dry-run

- [ ] **26.1** `pnpm package` → `brainwires-opfs.zip` ~1.2 MB at repo root.
- [ ] **26.2** Upload to a *draft* listing in the Chrome Web Store dev dashboard. Walk through the privacy form: data collection = none, single purpose = OPFS file management in DevTools.
- [ ] **26.3** No reviewer-blocking flags raised (broad host permissions, remote code, unjustified `<all_urls>`).

---

Track your run with: `cp TESTING.md TESTING.run.md` and check off as you go. Anything that
fails: copy the failing item number into a GitHub issue with browser version and console
output.
