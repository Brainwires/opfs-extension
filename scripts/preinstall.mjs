#!/usr/bin/env node
// preinstall hook: makes `pnpm install` self-sufficient on a fresh clone.
//
// 1. Initialise the rsqlite-wasm submodule if it isn't checked out yet.
// 2. (Dev only) Keep the submodule on origin/main and pull the latest commits.
//    Skipped in CI ($CI=true) so release builds use the pinned SHA, and skipped
//    if the submodule has uncommitted work or is on a non-main branch.
// 3. Build its wasm-pack output if it's missing OR if step 2 pulled new commits.
//
// Does nothing when everything's already current (so repeat installs are fast).
// Bails with a human-readable explanation if a prerequisite is missing (no git,
// no wasm-pack, etc.) instead of letting pnpm fail with ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND
// further down.
//
// Opt out of the auto-pull with BRAINWIRES_NO_AUTO_PULL=1.
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

function capture(args, cwd) {
  const r = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`${args.join(' ')} exited with ${r.status}: ${r.stderr || ''}`);
  }
  return r.stdout;
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

// Step 2 (dev only): keep submodule on main + pull latest.
//
// CI builds publish artifacts and need the pinned SHA to match what's recorded in
// the parent repo (otherwise reproducibility + provenance break). We detect CI via
// the standard $CI env var and skip the auto-pull there.
//
// We also skip if the submodule has REAL uncommitted work (modifications to
// tracked files OTHER than the build-touched ones) or is on a non-main branch —
// the user clearly has local changes and wouldn't want them clobbered.
//
// Files our own build is known to dirty (auto-restored before the dirty-check):
//   • js/package-lock.json — `npm install` rewrites it across npm versions.
//                            Now we use `npm ci`, but old runs may have left it dirty.
const BUILD_DIRTIES = ['js/package-lock.json'];
let pulledNewCommits = false;
if (!process.env.CI && !process.env.BRAINWIRES_NO_AUTO_PULL && hasCommand('git')) {
  try {
    const branch = capture(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], submoduleDir).trim();
    // Auto-restore files we know were dirtied by our own previous build runs.
    // `git restore --source=HEAD --` is a safe no-op if the file isn't actually dirty.
    for (const f of BUILD_DIRTIES) {
      const fileStatus = capture(['git', 'status', '--porcelain', '--', f], submoduleDir).trim();
      if (fileStatus) {
        console.error(
          yellow(`→ Restoring ${f} (was rewritten by a previous build)…`),
        );
        try {
          run('git', ['restore', '--source=HEAD', '--', f], { cwd: submoduleDir });
        } catch {
          // older git: fall back to checkout
          run('git', ['checkout', 'HEAD', '--', f], { cwd: submoduleDir });
        }
      }
    }
    // Now check for real dirt — modifications to tracked files we DIDN'T just
    // restore. Untracked files (e.g., js/README.md / js/LICENSE created by
    // build:meta) are intentionally ignored.
    const status = capture(
      ['git', 'status', '--porcelain', '--untracked-files=no'],
      submoduleDir,
    ).trim();
    if (status) {
      console.error(
        yellow('→ vendor/rsqlite-wasm has uncommitted changes — skipping auto-pull.'),
      );
      console.error(dim(status.split('\n').map((l) => '  ' + l).join('\n')));
    } else if (branch !== 'main' && branch !== 'HEAD') {
      console.error(
        yellow(`→ vendor/rsqlite-wasm is on '${branch}' (not main) — skipping auto-pull.`),
      );
    } else {
      const before = capture(['git', 'rev-parse', 'HEAD'], submoduleDir).trim();
      // Submodules default to detached HEAD after `submodule update --init`. Switch
      // to main first so `git pull` has a tracking branch to fast-forward.
      if (branch === 'HEAD') {
        run('git', ['checkout', 'main'], { cwd: submoduleDir });
      }
      console.error(yellow('→ Pulling latest rsqlite-wasm (origin/main)…'));
      run('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: submoduleDir });
      const after = capture(['git', 'rev-parse', 'HEAD'], submoduleDir).trim();
      if (before !== after) {
        pulledNewCommits = true;
        console.error(
          dim(`  ${before.slice(0, 7)} → ${after.slice(0, 7)} (rebuild forced)`),
        );
      }
    }
  } catch (e) {
    // Network failures, non-FF, missing remote — don't block the install. Use
    // whatever's already there.
    console.error(
      yellow('→ rsqlite-wasm pull failed (continuing with current commit): ') +
        dim(e.message),
    );
  }
}

// Step 3: build the wasm if needed (or if step 2 pulled new commits)
if (!existsSync(wasmFile) || pulledNewCommits) {
  console.error(
    yellow(pulledNewCommits ? '→ Rebuilding rsqlite-wasm…' : '→ Building rsqlite-wasm (one-time)…'),
  );
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
    // `npm ci` reproduces the exact lockfile contents (no rewrite) — avoids the
    // perpetual "modified js/package-lock.json" dirty state. Falls back to
    // `npm install` only if the lockfile is missing or out of sync.
    const ciResult = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
      stdio: 'inherit',
      cwd: submoduleJs,
      shell: process.platform === 'win32',
    });
    if (ciResult.status !== 0) {
      console.error(yellow('→ npm ci failed; falling back to npm install…'));
      run('npm', ['install', '--no-audit', '--no-fund'], { cwd: submoduleJs });
    }
    run('npm', ['run', 'build'], { cwd: submoduleJs });
  } catch (e) {
    bail(
      `rsqlite-wasm build failed: ${e.message}`,
      'Try running it manually for full output:\n  cd vendor/rsqlite-wasm/js && npm ci && npm run build',
    );
  }
}

console.error(green('✓') + dim(' rsqlite-wasm submodule + wasm artifacts ready'));
