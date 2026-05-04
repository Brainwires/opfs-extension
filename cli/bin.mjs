#!/usr/bin/env node
// Brainwires OPFS extension installer.
//
// Ships the prebuilt extension in ./dist/ (populated by `pnpm cli:bundle`).
// On run: extracts a versioned copy under the user's data dir, prints the
// path to feed `Load unpacked`, and (with --launch) opens chrome://extensions.

import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const args = process.argv.slice(2);
const has = (...names) => args.some((a) => names.includes(a));

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
};

function help() {
  console.log(`
${c.bold('brainwires-opfs')}  ${c.dim('v' + pkg.version)}
${c.dim('Install the Brainwires OPFS Chrome DevTools extension without the Web Store.')}

${c.bold('Usage:')}
  npx brainwires-opfs [command] [flags]

${c.bold('Commands:')}
  ${c.cyan('install')}    Default. Extract the bundled extension to a stable user-data path.
  ${c.cyan('uninstall')}  Remove the extracted copy. (You also need to remove it in chrome://extensions.)
  ${c.cyan('path')}       Print the install path (no side effects).
  ${c.cyan('help')}       Show this message.

${c.bold('Flags:')}
  --launch[=chrome|chromium|brave|edge|arc]
              After install, open chrome://extensions in the chosen browser
              (auto-detected if no value given).
  --target <dir>
              Override the install path (default: ${c.dim(defaultInstallDir())}).
  --json      Emit a JSON status block (useful for scripting).

${c.bold('Quick start:')}
  $ ${c.green('npx brainwires-opfs')}
  ${c.dim('# then in Chrome:')}
  ${c.dim('# 1. open chrome://extensions')}
  ${c.dim('# 2. enable Developer mode')}
  ${c.dim('# 3. click "Load unpacked" → paste the path printed above')}

${c.bold('One-liner that does it all (Mac/Linux):')}
  $ ${c.green('npx brainwires-opfs --launch')}
`);
}

function defaultInstallDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'BrainwiresOPFS', pkg.version);
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
      'BrainwiresOPFS',
      pkg.version,
    );
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(xdg, 'brainwires-opfs', pkg.version);
}

// Track which args are consumed as flag values so they're not mistaken for the command.
const consumed = new Set();
function flagValue(name) {
  const eqArg = args.find((a) => a.startsWith(`--${name}=`));
  if (eqArg) {
    consumed.add(eqArg);
    return eqArg.slice(name.length + 3);
  }
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  consumed.add(args[idx]);
  const next = args[idx + 1];
  if (next && !next.startsWith('--')) {
    consumed.add(next);
    return next;
  }
  return ''; // present without value
}

const target = flagValue('target') || defaultInstallDir();
const launchValue = flagValue('launch');
const jsonOut = has('--json');
const cmd = args.find((a) => !a.startsWith('--') && !consumed.has(a)) || 'install';

if (cmd === 'help' || has('-h', '--help')) {
  help();
  process.exit(0);
}

if (cmd === 'path') {
  if (jsonOut) console.log(JSON.stringify({ path: target, version: pkg.version }, null, 2));
  else console.log(target);
  process.exit(0);
}

if (cmd === 'uninstall') {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    if (jsonOut) console.log(JSON.stringify({ removed: target, version: pkg.version }));
    else console.log(`${c.green('✓')} Removed ${target}`);
  } else {
    if (jsonOut) console.log(JSON.stringify({ removed: null, version: pkg.version }));
    else console.log(`${c.dim('Nothing to remove at')} ${target}`);
  }
  console.log(c.dim('\nDon\'t forget to remove the extension in chrome://extensions as well.'));
  process.exit(0);
}

if (cmd !== 'install') {
  console.error(c.red(`Unknown command: ${cmd}`));
  help();
  process.exit(2);
}

// Install
const distDir = path.join(__dirname, 'dist');
if (!existsSync(distDir) || !existsSync(path.join(distDir, 'manifest.json'))) {
  console.error(
    c.red('✗') +
      ' This installer is missing its bundled extension files (cli/dist/manifest.json).',
  );
  console.error(
    c.dim('  This means the npm package was published incorrectly. Please file an issue.\n'),
  );
  process.exit(1);
}

mkdirSync(path.dirname(target), { recursive: true });
if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}
cpSync(distDir, target, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(target, 'manifest.json'), 'utf-8'));
const totalBytes = walkSize(target);

const result = {
  version: pkg.version,
  manifestVersion: manifest.version,
  path: target,
  sizeBytes: totalBytes,
};

if (jsonOut) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`
${c.green('✓')} ${c.bold('Brainwires OPFS')} ${c.dim('v' + manifest.version)} extracted to:
   ${c.cyan(target)}
   ${c.dim((totalBytes / (1024 * 1024)).toFixed(1) + ' MB · ' + countFiles(target) + ' files')}

${c.bold('Load it into Chrome:')}
   1. Open ${c.magenta('chrome://extensions')}
   2. Enable ${c.bold('Developer mode')} (top right toggle)
   3. Click ${c.bold('Load unpacked')} and select the path above
   4. Open DevTools on any page → there's now an ${c.bold('OPFS')} tab

${c.dim('Re-run later with')} ${c.cyan('npx brainwires-opfs@latest')} ${c.dim('to update.')}
${c.dim('Remove with')} ${c.cyan('npx brainwires-opfs uninstall')}.
`);
}

if (launchValue !== null) {
  const browser = launchValue || detectBrowser();
  if (!browser) {
    console.error(
      c.yellow('!') +
        ' Could not auto-detect a Chromium-based browser. Open chrome://extensions yourself.',
    );
    process.exit(0);
  }
  console.log(`${c.dim('→ Opening chrome://extensions in')} ${c.bold(browser)}…`);
  openBrowser(browser, 'chrome://extensions');
}

function walkSize(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += walkSize(p);
    else n += statSync(p).size;
  }
  return n;
}
function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

function detectBrowser() {
  const platform = process.platform;
  const checks = {
    darwin: [
      ['chrome', '/Applications/Google Chrome.app'],
      ['chromium', '/Applications/Chromium.app'],
      ['brave', '/Applications/Brave Browser.app'],
      ['edge', '/Applications/Microsoft Edge.app'],
      ['arc', '/Applications/Arc.app'],
    ],
    linux: [
      ['chrome', '/usr/bin/google-chrome'],
      ['chrome', '/usr/bin/google-chrome-stable'],
      ['chromium', '/usr/bin/chromium'],
      ['chromium', '/usr/bin/chromium-browser'],
      ['brave', '/usr/bin/brave-browser'],
      ['edge', '/usr/bin/microsoft-edge'],
    ],
    win32: [
      ['chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
      ['chrome', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
      ['edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
      ['brave', 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    ],
  };
  for (const [name, p] of checks[platform] ?? []) {
    if (existsSync(p)) return name;
  }
  return null;
}

function openBrowser(browser, url) {
  if (process.platform === 'darwin') {
    const appByName = {
      chrome: 'Google Chrome',
      chromium: 'Chromium',
      brave: 'Brave Browser',
      edge: 'Microsoft Edge',
      arc: 'Arc',
    };
    const app = appByName[browser] || browser;
    spawn('open', ['-a', app, url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const binByName = {
    chrome: 'google-chrome',
    chromium: 'chromium',
    brave: 'brave-browser',
    edge: 'microsoft-edge',
  };
  const bin = binByName[browser] || browser;
  spawn(bin, [url], { detached: true, stdio: 'ignore' }).unref();
}
