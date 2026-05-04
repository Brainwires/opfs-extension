#!/usr/bin/env node
// Bundles the freshly built dist/ into cli/dist/ and syncs cli/package.json
// version with the root package.json. Run: `pnpm cli:bundle`.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const cliDir = path.join(root, 'cli');
const cliDist = path.join(cliDir, 'dist');

if (!existsSync(path.join(dist, 'manifest.json'))) {
  console.error('✗ dist/manifest.json missing — run `pnpm build` first');
  process.exit(1);
}

if (existsSync(cliDist)) rmSync(cliDist, { recursive: true, force: true });
cpSync(dist, cliDist, { recursive: true });

const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
const cliPkg = JSON.parse(readFileSync(path.join(cliDir, 'package.json'), 'utf-8'));
if (cliPkg.version !== rootPkg.version) {
  cliPkg.version = rootPkg.version;
  writeFileSync(path.join(cliDir, 'package.json'), JSON.stringify(cliPkg, null, 2) + '\n');
  console.log(`✓ synced cli/package.json version → ${rootPkg.version}`);
}

console.log(`✓ bundled dist/ into cli/dist/ (version ${cliPkg.version})`);
