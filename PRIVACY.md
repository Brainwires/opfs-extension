# Privacy Policy

**Brainwires OPFS** is a Chrome DevTools extension that lets a developer browse, view, and
modify files in the Origin Private File System (OPFS) of the page being inspected.

## What we collect

**Nothing.** The extension does not collect, store, transmit, or sell any personal data,
browsing history, file contents, telemetry, analytics, crash reports, or any other
information.

## How file access works

OPFS data is read and written entirely inside your own browser, on your own machine, in the
context of the inspected page. No file contents ever leave your computer through this
extension. There is no backend server. There are no third-party services. Network access is
not declared in the extension's manifest at all.

When you export an OPFS snapshot to a `.zip`, the file is generated locally and downloaded
through the browser's standard download mechanism. When you import a `.zip`, it is read
locally and written into the inspected origin's OPFS.

## Permissions

The extension's manifest declares only `devtools_page`. It does **not** request
`<all_urls>`, `host_permissions`, `tabs`, `cookies`, `webRequest`, `storage`, or any other
runtime permission. The DevTools API automatically grants the panel access to the page
being inspected when DevTools is open — that is the only way it can reach the page.

## Open source

The full source code is published at https://github.com/brainwires/opfs (MIT licensed).
You can build the extension yourself and verify byte-for-byte that the version on the
Chrome Web Store matches the tagged release.

## Contact

For privacy questions, open an issue on the GitHub repository.

_Last updated: 2026-05-04._
