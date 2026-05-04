#!/usr/bin/env node
// Verifies the rsqlite-wasm submodule is initialized and the wasm-pack output exists
// before pnpm tries to resolve the file: link. Prints a friendly fix-it command if not.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const submoduleDir = path.join(root, 'vendor', 'rsqlite-wasm');
const submoduleJs = path.join(submoduleDir, 'js');
const wasmFile = path.join(submoduleJs, 'dist', 'wasm', 'rsqlite_wasm_bg.wasm');

function bail(msg) {
  console.error('\n\x1b[31m✗\x1b[0m ' + msg);
  console.error('\nFix:\n  \x1b[36mpnpm run setup\x1b[0m\n');
  console.error('That runs:');
  console.error('  git submodule update --init --recursive');
  console.error('  cd vendor/rsqlite-wasm/js && npm install && npm run build\n');
  console.error('Prerequisites: Rust + wasm-pack on PATH (https://rustwasm.github.io/wasm-pack/)\n');
  process.exit(1);
}

// Check submodule is checked out
let hasSubmodule = false;
try {
  const entries = readdirSync(submoduleDir);
  hasSubmodule = entries.length > 0 && existsSync(path.join(submoduleDir, '.git'));
} catch {
  hasSubmodule = false;
}
if (!hasSubmodule) {
  bail('vendor/rsqlite-wasm submodule is not initialized.');
}

// Check the file: target exists
if (!existsSync(path.join(submoduleJs, 'package.json'))) {
  bail('vendor/rsqlite-wasm/js/package.json missing — submodule contents look incomplete.');
}

// Check the wasm built artifact (the package's exports do work without it, but the
// extension will fail at runtime in the SqliteViewer with a misleading error).
if (!existsSync(wasmFile)) {
  bail('vendor/rsqlite-wasm/js/dist/wasm/rsqlite_wasm_bg.wasm missing — engine has not been built.');
}
