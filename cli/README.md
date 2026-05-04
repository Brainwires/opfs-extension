# brainwires-opfs

One-command installer for the [Brainwires OPFS](https://github.com/Brainwires/opfs-extension)
Chrome DevTools extension. Skips the Web Store — ships the prebuilt extension in this
package and walks you through `Load unpacked`.

## Why

The Web Store review process is slow and we trust ourselves more than we trust the
store's review for a tool that touches OPFS. Distributing via npm gives us:

- **Per-version reproducibility.** `npx brainwires-opfs@0.1.0` always installs that exact
  build.
- **Zero account requirement.** No Google account, no developer fee, no review queue.
- **Works on any machine with Node.** No git clone, no Rust toolchain, no `pnpm install`.

## Quick start

```bash
npx brainwires-opfs           # extract + print Load unpacked instructions
npx brainwires-opfs --launch  # also open chrome://extensions automatically
```

That's it. Open DevTools on any page and switch to the **OPFS** tab.

## Commands

| Command | What it does |
|---|---|
| `install` (default) | Extract the bundled extension to a stable user-data path and print Load unpacked instructions. |
| `uninstall` | Remove the extracted copy from disk. (Doesn't reach into Chrome — remove the extension from `chrome://extensions` separately.) |
| `path` | Print the install path. No side effects. Useful for scripting. |
| `help` | Show usage. |

## Flags

| Flag | Description |
|---|---|
| `--launch[=chrome\|chromium\|brave\|edge\|arc]` | After install, open `chrome://extensions` in the named (or auto-detected) browser. |
| `--target <dir>` | Override where the extension is extracted. |
| `--json` | Emit a JSON status block instead of human-readable output. |

## Install path defaults

- **macOS:** `~/Library/Application Support/BrainwiresOPFS/<version>/`
- **Linux:** `$XDG_DATA_HOME/brainwires-opfs/<version>/` (or `~/.local/share/brainwires-opfs/<version>/`)
- **Windows:** `%LOCALAPPDATA%\BrainwiresOPFS\<version>\`

Each version goes into its own subdirectory so you can keep multiple side-by-side and
point Chrome at whichever you want.

## Updating

Re-run with the `@latest` tag to fetch and extract the newest published build:

```bash
npx brainwires-opfs@latest
```

Then in Chrome's `chrome://extensions` page, hit **↻ reload** on the extension card so it
picks up the new files. (Chrome doesn't auto-reload unpacked extensions.)

## License

[MIT](https://github.com/Brainwires/opfs-extension/blob/main/LICENSE)
