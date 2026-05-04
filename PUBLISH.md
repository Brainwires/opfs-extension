# Publishing playbook

How `brainwires-opfs` ships, how to do the one-time setup, how to cut a release, and
how end users verify what they're installing.

We do **not** publish to the Chrome Web Store. We publish the prebuilt extension to
**npm** and end users install it with a single `npx brainwires-opfs` command. The
`cli/` subpackage is the unit of distribution; the rest of the repo is source.

## How publishes happen (steady state)

Tag a `v*` commit, push the tag, the release workflow does everything:

```bash
# bump cli/package.json + root package.json to the new version, then:
git tag v0.2.0
git push --tags
```

`.github/workflows/release.yml` runs:

1. Checkout (with submodules)
2. Install Rust + wasm-pack, cache the cargo build
3. `pnpm setup:rsqlite` (builds the engine wasm)
4. `pnpm install`
5. `pnpm typecheck` · `pnpm test:unit` · `pnpm test:bridge` (Playwright + Chromium)
6. `pnpm build` · `pnpm validate:dist`
7. `pnpm cli:bundle` (copies `dist/` → `cli/dist/`)
8. Zip `dist/` and upload to the GitHub release
9. **`npm publish --provenance --access public`** from `cli/` via npm Trusted Publishing

No `NPM_TOKEN` secret. The workflow proves its identity to npm with a short-lived
GitHub OIDC token (`id-token: write` permission in the job). Provenance attestations
are auto-attached so anyone can `npm audit signatures brainwires-opfs` and verify the
bytes came from this exact commit + workflow run.

## One-time setup

Trusted Publishing needs the package to exist on npm before npm can validate
publishes against it. That means **the very first publish has to claim the name
manually**. After that, every subsequent release is fully automated and
credential-free.

### Step 1 — make sure the name is yours

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/brainwires-opfs
# 404 = available, 200 = taken
```

If it's taken by someone else, change the `name` field in `cli/package.json` to a
scoped name like `@brainwires/opfs-installer`, update README links, and re-run.

### Step 2 — claim the name with one manual publish

From a machine where you're logged into npm (your Mac is fine):

```bash
# from a fresh checkout of the repo
git clone --recurse-submodules https://github.com/Brainwires/opfs-extension.git
cd opfs-extension
pnpm install                  # auto-builds rsqlite-wasm via the preinstall hook
pnpm build
pnpm cli:bundle               # populates cli/dist/

cd cli
npm login                     # opens a browser window for OAuth, or use a granular token
npm publish --provenance --access public
```

Provenance from a local machine works as long as you ran the build in CI-like
conditions (in practice, that means it'll succeed but won't have GH Actions
attestations — that's fine for the bootstrap publish; subsequent CI publishes
will have them).

### Step 3 — register the GitHub workflow as a Trusted Publisher

1. Sign in at https://www.npmjs.com
2. Go to https://www.npmjs.com/package/brainwires-opfs/access (if scoped:
   https://www.npmjs.com/package/@brainwires/opfs-installer/access)
3. Scroll to **Trusted Publishers** → **Add Trusted Publisher**
4. Pick **GitHub Actions** and fill in:
   - **Organization or user**: `Brainwires`
   - **Repository**: `opfs-extension`
   - **Workflow filename**: `release.yml`
   - **Environment name**: leave blank
5. Save.

That's it. Future `git push --tags` releases publish without any token.

### Step 4 — verify by cutting `v0.1.1`

```bash
# bump versions if needed (root + cli/package.json), then:
git tag v0.1.1
git push --tags
```

Watch the Actions tab. If the publish step succeeds:

```bash
npm view brainwires-opfs version           # should show 0.1.1
npm audit signatures brainwires-opfs       # should print "verified"
```

## Cutting a release (every time after bootstrap)

```bash
# 1. Bump versions in root package.json AND cli/package.json (keep them in sync)
#    pnpm cli:bundle does this automatically, but tag commits should bump root first.
node -e "const fs=require('fs');for(const f of ['package.json','cli/package.json']){const p=JSON.parse(fs.readFileSync(f));p.version='0.2.0';fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')}"

# 2. Commit, tag, push
git add package.json cli/package.json
git commit -m "Release v0.2.0"
git tag v0.2.0
git push origin main --tags
```

CI handles the rest: build → test → publish → GitHub release.

## What end users do

```bash
npx brainwires-opfs            # extract + Load unpacked instructions
npx brainwires-opfs --launch   # also opens chrome://extensions
```

That's the entire install flow on a clean machine. No git clone, no Rust, no pnpm,
no Web Store account, no developer-mode warning popup beyond the one Chrome shows
for any unpacked extension.

## What happens if the publish step fails

Common failure modes and what to do:

- **`E403 cannot publish over the previously published versions`** — you forgot to
  bump the version. Fix and re-tag.
- **`E401 unauthorized`** — Trusted Publisher not configured for this package, or
  workflow filename / org / repo doesn't match what's registered on npm. Recheck Step 3.
- **`name is too similar to an existing package`** — pick a different name in
  `cli/package.json`.
- **Provenance attestation fails** — make sure `permissions: id-token: write` is
  set on the job (it is) and that npm CLI is `>= 11.5` (the workflow has
  `npm install -g npm@latest` to handle this).

The GitHub release zip step doesn't depend on the npm publish, so even if npm
fails, users can fall back to downloading the zip from
https://github.com/Brainwires/opfs-extension/releases and Load-unpacked-ing it
manually.

## Deprecating a release

```bash
npm deprecate brainwires-opfs@0.1.0 "Has a CSP bug; use 0.1.1 or later"
```

`npm unpublish` is heavily restricted (only within 72 hours of publish, and only if
no other package depends on it). Deprecate, don't unpublish.

## Updating the rsqlite-wasm submodule

The published bytes pin a specific rsqlite-wasm commit. To bump:

```bash
cd vendor/rsqlite-wasm
git pull origin main
cd ../..
pnpm setup:rsqlite          # rebuilds the wasm at the new commit
git add vendor/rsqlite-wasm
git commit -m "Bump rsqlite-wasm to <short-sha>"
# then bump version + tag as a normal release
```
