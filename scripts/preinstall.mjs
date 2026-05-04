#!/usr/bin/env node
// preinstall hook: makes `pnpm install` self-sufficient on a fresh clone.
//
// 1. Initialise the rsqlite-wasm submodule if it isn't checked out yet.
// 2. Build its wasm-pack output if dist/wasm/rsqlite_wasm_bg.wasm doesn't exist.
//
// Does nothing when both already true (so repeat installs are fast). Bails with a
// human-readable explanation if a prerequisite is missing (no git, no wasm-pack, etc.)
// instead of letting pnpm fail with ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND further down.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const submoduleDir = path.join(root, 'vendor', 'rsqlite-wasm');
const submoduleJs = path.join(submoduleDir, 'js');
const wasmFile = path.join(submoduleJs, 'dist', 'wasm', 'rsqlite_wasm_bg.wasm');

const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function bail(msg, hint) {
  console.error(`\n${red('✗')} ${msg}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

function hasCommand(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'command', ['-v', cmd], {
    stdio: 'ignore',
    shell: true,
  });
  return r.status === 0;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? root,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  }
}

function isSubmoduleCheckedOut() {
  if (!existsSync(submoduleDir)) return false;
  let entries = [];
  try {
    entries = readdirSync(submoduleDir);
  } catch {
    return false;
  }
  return entries.length > 0 && existsSync(path.join(submoduleDir, '.git'));
}

// Step 1: submodule init
if (!isSubmoduleCheckedOut()) {
  console.error(yellow('→ Initialising vendor/rsqlite-wasm submodule…'));
  if (!hasCommand('git')) {
    bail(
      'git is not on PATH; cannot initialise the rsqlite-wasm submodule.',
      'Install git, then re-run `pnpm install`.\n' +
        'Alternatively, manually drop the rsqlite-wasm sources at vendor/rsqlite-wasm.',
    );
  }
  if (!existsSync(path.join(root, '.git'))) {
    bail(
      'This is not a git checkout, so submodules cannot be initialised.',
      'Either:\n' +
        '  • Re-clone with: git clone --recurse-submodules <repo>\n' +
        '  • Or download a release tarball that bundles vendor/rsqlite-wasm pre-built.',
    );
  }
  try {
    run('git', ['submodule', 'update', '--init', '--recursive']);
  } catch (e) {
    bail(`git submodule init failed: ${e.message}`);
  }
}

// Step 2: build the wasm if needed
if (!existsSync(wasmFile)) {
  console.error(yellow('→ Building rsqlite-wasm (one-time)…'));
  if (!hasCommand('wasm-pack')) {
    bail(
      'wasm-pack is not on PATH; cannot build rsqlite-wasm.',
      'Install with one of:\n' +
        '  • curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh   (Linux/macOS)\n' +
        '  • cargo install wasm-pack\n' +
        '\nThen re-run `pnpm install`.\n' +
        '(You also need a Rust toolchain — https://rustup.rs)',
    );
  }
  if (!hasCommand('cargo')) {
    bail(
      'cargo is not on PATH; cannot build rsqlite-wasm.',
      'Install Rust: https://rustup.rs\nThen re-run `pnpm install`.',
    );
  }
  if (!hasCommand('npm')) {
    bail(
      'npm is not on PATH (rsqlite-wasm uses npm scripts internally).',
      'Install Node.js (which ships with npm), then re-run `pnpm install`.',
    );
  }
  try {
    run('npm', ['install', '--no-audit', '--no-fund'], { cwd: submoduleJs });
    run('npm', ['run', 'build'], { cwd: submoduleJs });
  } catch (e) {
    bail(
      `rsqlite-wasm build failed: ${e.message}`,
      'Try running it manually for full output:\n  cd vendor/rsqlite-wasm/js && npm install && npm run build',
    );
  }
}

console.error(green('✓') + dim(' rsqlite-wasm submodule + wasm artifacts ready'));
