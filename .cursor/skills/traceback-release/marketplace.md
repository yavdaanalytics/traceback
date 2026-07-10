# Marketplace handoff (yavda-marketplace)

After `release-tag.yml` succeeds (npm + GitHub Release), publish host plugins by
updating the private org catalog:

**https://github.com/yavdaanalytics/yavda-marketplace**

Users install via that marketplace (not by uploading release zips to a public store UI):

| Host | Manifest | Install |
|------|----------|---------|
| Claude Code | `.claude-plugin/marketplace.json` | `/plugin marketplace add yavdaanalytics/yavda-marketplace` then `/plugin install traceback@yavda-tools` |
| Cursor | `.cursor-plugin/marketplace.json` | Import `yavdaanalytics/yavda-marketplace`, then install `traceback` |

Release zips on the GitHub Release remain useful as artifacts / checksums, but the
**canonical publish path for Claude + Cursor is bumping this catalog**.

## Current wiring (do not invent a different shape)

**Claude** — plugin entry uses a git subdir of the traceback repo:

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/yavdaanalytics/traceback.git",
  "path": "plugins/claude-traceback",
  "ref": "main",
  "sha": "<commit SHA on main that contains the release>"
},
"version": "<same as traceback package.json>"
```

**Cursor** — plugin entry points at the vendored folder in the marketplace repo:

```json
"name": "traceback",
"source": "traceback",
"version": "<same as traceback package.json>"
```

The Cursor package lives at `yavda-marketplace/traceback/` (copy of
`traceback/plugins/cursor-traceback/`).

## Step-by-step after a traceback release (e.g. v0.1.3)

Set `VER` and `SHA` from the traceback release commit on `main` (the tagged
release SHA, not an unrelated docs-only tip unless that tip is what you want
shipped):

```sh
# from traceback repo
VER=$(node -p "require('./package.json').version")
SHA=$(git rev-parse "v${VER}^{commit}")
```

### 1. Clone / update yavda-marketplace

```sh
gh repo clone yavdaanalytics/yavda-marketplace
cd yavda-marketplace
git checkout main
git pull
```

### 2. Claude catalog — bump traceback entry

Edit `.claude-plugin/marketplace.json`:

1. Find `plugins[]` where `name === "traceback"`.
2. Set `version` to `$VER`.
3. Set `source.ref` to `main` (or the release tag if you prefer a tag ref).
4. Set `source.sha` to `$SHA`.
5. Optionally bump the top-level marketplace `version` (catalog semver, e.g. `1.0.4` → `1.0.5`).

### 3. Cursor catalog — sync vendored plugin + bump entry

```sh
# from yavda-marketplace root; TRACEBACK_ROOT = path to traceback checkout
rm -rf traceback
cp -R "$TRACEBACK_ROOT/plugins/cursor-traceback" traceback
```

On Windows (PowerShell):

```powershell
Remove-Item -Recurse -Force traceback
Copy-Item -Recurse "$env:TRACEBACK_ROOT\plugins\cursor-traceback" traceback
```

Edit `.cursor-plugin/marketplace.json`:

1. Find `plugins[]` where `name === "traceback"`.
2. Set `version` to `$VER`.
3. Keep `"source": "traceback"`.
4. Optionally bump `metadata.version` to match the Claude catalog bump.

Confirm `traceback/.cursor-plugin/plugin.json` `version` equals `$VER` (comes from the copy).

### 4. Commit and push the marketplace repo

```sh
git add .claude-plugin/marketplace.json .cursor-plugin/marketplace.json traceback
git commit -m "chore: publish traceback@${VER}"
git push origin main
```

Only push when the user asked to publish the marketplace update.

### 5. Smoke-check

**Claude Code**

```text
/plugin marketplace update yavda-tools
/plugin install traceback@yavda-tools
```

**Cursor** — refresh/import the marketplace, update `traceback`.

Then:

```sh
npx -y -p @yavdaanalytics/traceback traceback-setup --plugin --doctor
```

## Artifacts (secondary)

From `https://github.com/yavdaanalytics/traceback/releases/tag/vX.Y.Z`:

| File | Package root |
|------|----------------|
| `claude-traceback-vX.Y.Z.zip` | `plugins/claude-traceback/` |
| `cursor-traceback-vX.Y.Z.zip` | `plugins/cursor-traceback/` |

Use these if someone needs a zip; do **not** treat zip upload as the primary
Claude/Cursor publish path when `yavda-marketplace` is available.

## Agent notes

- `yavda-marketplace` is **private** — use `gh` with org auth; do not assume public raw URLs work.
- Never commit marketplace API tokens.
- Claude `source.sha` must point at a commit that actually contains
  `plugins/claude-traceback` at the released version.
- Cursor requires a **file sync** into `yavda-marketplace/traceback/`; updating
  JSON alone is not enough.
- Keep Claude and Cursor traceback `version` fields identical to
  `@yavdaanalytics/traceback` / plugin manifests.
- Official Anthropic/Cursor *public* store UIs are out of scope unless the user
  explicitly asks; default to this org marketplace.
