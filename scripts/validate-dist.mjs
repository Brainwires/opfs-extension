#!/usr/bin/env node
// Static validator for dist/. Exits 0 if everything looks shippable.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const DIST = path.resolve(process.argv[2] ?? 'dist');
const errs = [];
const oks = [];

function ok(msg) {
  oks.push(msg);
}
function err(msg) {
  errs.push(msg);
}

if (!existsSync(DIST)) {
  console.error(`dist not found at ${DIST} — run \`pnpm build\` first`);
  process.exit(1);
}

const manifestPath = path.join(DIST, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  ok('manifest.json parses');
} catch (e) {
  err(`manifest.json failed to parse: ${e.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) err('manifest_version must be 3');
  else ok('manifest_version: 3');

  if (!manifest.devtools_page) err('missing devtools_page');
  else ok(`devtools_page: ${manifest.devtools_page}`);

  if (manifest.host_permissions) err('SHOULD NOT declare host_permissions for a pure devtools extension');
  else ok('no host_permissions (good)');

  if (manifest.permissions && manifest.permissions.length) {
    err(`SHOULD NOT declare runtime permissions (saw: ${manifest.permissions.join(', ')})`);
  } else {
    ok('no runtime permissions (good)');
  }

  if (manifest.background) err('SHOULD NOT declare a background service worker for this extension');
  else ok('no background service worker (good)');

  if (manifest.content_scripts) err('SHOULD NOT declare content_scripts');
  else ok('no content_scripts (good)');

  for (const [size, rel] of Object.entries(manifest.icons || {})) {
    const p = path.join(DIST, rel);
    if (!existsSync(p)) err(`icon ${size} missing: ${rel}`);
    else ok(`icon ${size}: ${rel}`);
  }

  if (manifest.devtools_page) {
    if (!existsSync(path.join(DIST, manifest.devtools_page))) {
      err(`devtools_page file missing: ${manifest.devtools_page}`);
    }
  }

  if (manifest.minimum_chrome_version) ok(`minimum_chrome_version: ${manifest.minimum_chrome_version}`);

  // MV3 default CSP blocks WASM. We ship multiple wasm modules (rsqlite-wasm,
  // pdfjs), so the CSP must include 'wasm-unsafe-eval'. Without this the
  // SQLite viewer fails at load with a CompileError.
  const csp = manifest.content_security_policy?.extension_pages;
  if (!csp) {
    err('content_security_policy.extension_pages missing — WASM modules will be blocked');
  } else if (!csp.includes("'wasm-unsafe-eval'")) {
    err(`extension_pages CSP missing 'wasm-unsafe-eval' — WASM modules will be blocked. Got: ${csp}`);
  } else {
    ok("CSP allows 'wasm-unsafe-eval' (WASM will load)");
  }
}

// Check critical entry HTMLs exist
for (const f of ['index.html', 'panel.html']) {
  if (existsSync(path.join(DIST, f))) ok(`${f} exists`);
  else err(`${f} missing`);
}

// rsqlite-wasm artifacts (JS glue + .wasm) must be alongside each other for the
// glue's `new URL('rsqlite_wasm_bg.wasm', import.meta.url)` to resolve.
for (const f of ['rsqlite-wasm/rsqlite_wasm.js', 'rsqlite-wasm/rsqlite_wasm_bg.wasm']) {
  if (existsSync(path.join(DIST, f))) ok(`${f} exists`);
  else err(`${f} missing — SQLite viewer will fail to boot`);
}

// Check that index.html and panel.html reference assets that exist
async function checkHtmlReferences(htmlFile) {
  const html = await readFile(path.join(DIST, htmlFile), 'utf-8');
  const refs = [...html.matchAll(/(?:src|href)=['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (ref.startsWith('http') || ref.startsWith('data:')) continue;
    const cleaned = ref.replace(/^\//, '');
    if (!existsSync(path.join(DIST, cleaned))) err(`${htmlFile} references missing asset: ${ref}`);
  }
  ok(`${htmlFile}: ${refs.length} asset references all resolve`);
}
await checkHtmlReferences('index.html');
await checkHtmlReferences('panel.html');

// Confirm bundle has the bridge installer source inlined (for the panel chunk)
const assetsDir = path.join(DIST, 'assets');
if (existsSync(assetsDir)) {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(assetsDir);
  const panelChunk = files.find((f) => f.startsWith('panel-') && f.endsWith('.js'));
  if (!panelChunk) {
    err('no panel-*.js chunk found in assets/');
  } else {
    const src = await readFile(path.join(assetsDir, panelChunk), 'utf-8');
    if (!src.includes('__BRAINWIRES_OPFS__')) {
      err(`panel chunk ${panelChunk} does not contain bridge marker __BRAINWIRES_OPFS__`);
    } else {
      ok(`panel chunk inlines bridge installer (${panelChunk})`);
    }
    const sizeKb = ((await stat(path.join(assetsDir, panelChunk))).size / 1024).toFixed(0);
    ok(`panel chunk size: ${sizeKb} KB`);
  }
}

console.log('');
for (const m of oks) console.log(`  \x1b[32m✓\x1b[0m ${m}`);
for (const m of errs) console.log(`  \x1b[31m✗\x1b[0m ${m}`);
console.log('');
if (errs.length) {
  console.log(`\x1b[31m${errs.length} problem${errs.length === 1 ? '' : 's'} found.\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mAll ${oks.length} checks passed.\x1b[0m`);
