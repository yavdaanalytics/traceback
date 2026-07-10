---
name: traceback-release
description: >-
  Cut a traceback maintainer release to the public OSS GitHub repo, npm
  (@yavdaanalytics/traceback), and Claude/Cursor plugin artifacts. Use when the
  user asks to release, publish, cut a version, bump and tag, push a v* tag,
  publish to npm, OIDC trusted publishing, update the Claude marketplace plugin,
  or update the Cursor marketplace plugin.
---

# Traceback release

Canonical maintainer workflow for shipping traceback. Source of truth for
one-time OSS prep: [`docs/PUBLIC_RELEASE.md`](../../../docs/PUBLIC_RELEASE.md).
CI: [`.github/workflows/release-tag.yml`](../../../.github/workflows/release-tag.yml).

## Hard rules

- Do **not** push `main`, tags, or remotes unless the user explicitly asks to publish/push.
- Do **not** force-push, amend published history, or skip hooks.
- Tag must be `v` + exact `package.json` version (CI fails otherwise).
- Prefer the tag-triggered CI path over local `npm publish`.
- Publish via **OIDC trusted publishing** (no interactive 2FA / security-key prompt in CI).
- Claude/Cursor **marketplace listing** is via the private
  [yavda-marketplace](https://github.com/yavdaanalytics/yavda-marketplace) catalog
  (see [marketplace.md](marketplace.md)) — CI only attaches plugin zips as artifacts.
- If the release workflow itself changes, **bump a new patch version and tag** (do not re-run an old tag — `gh workflow run --ref vX.Y.Z` uses the workflow file *on that tag*).

## Progress checklist

Copy and update as you go:

```
Release Progress:
- [ ] 0. Confirm intent + version bump type
- [ ] 1. Preflight (clean tree, on main, tests)
- [ ] 2. Bump package.json version + sync plugins
- [ ] 3. Commit version/plugin sync (+ workflow fixes if any)
- [ ] 4. Push main to origin (OSS)
- [ ] 5. Create and push v* tag
- [ ] 6. Wait for release-tag workflow (release job must succeed)
- [ ] 7. Verify npm + GitHub Release artifacts
- [ ] 8. Marketplace handoff (Claude + Cursor)
```

## Step 0 — Confirm intent

Ask only if missing:

1. Semver bump: patch / minor / major (or exact version).
2. Whether to **push** now (OSS + tag) or stop after local commit/tag.
3. Whether to also walk marketplace submission after CI succeeds.

## Step 1 — Preflight

From repo root:

```sh
git status -sb
git remote -v
git branch --show-current
git fetch origin
git log -1 --oneline
npm ci
npm run build
npm test -- --maxWorkers=1
```

Requirements:

- Working tree clean (or only intentional release files).
- Branch is `main` (or user-approved release branch that will merge first).
- `origin` is `https://github.com/yavdaanalytics/traceback.git` (or SSH equivalent).
- Build + tests pass.

If uncommitted feature work remains, stop and get it merged before releasing.

## Step 2 — Version + plugin sync

1. Bump `"version"` in `package.json` **and** the root/`packages[""]` entries in `package-lock.json`.
2. Sync plugin shells from portable setup assets:

```sh
npm run build
npm run release:sync-plugins
```

This updates:

- `plugins/claude-traceback/.claude-plugin/plugin.json` version + assets
- `plugins/cursor-traceback/.cursor-plugin/plugin.json` version + assets
- skills / hooks / mcp / Cursor rule copies under `plugins/*`

## Step 3 — Commit

Commit the version bump and any plugin sync diffs. Follow the repo commit style; example:

```text
chore: release vX.Y.Z
```

Only create the commit when the user asked to release/commit.

## Step 4 — Publish to OSS (GitHub)

```sh
git push origin main
```

This updates the public repo. Do not skip this before tagging if `main` is behind local commits.

## Step 5 — Tag and trigger release CI

```sh
git tag "v$(node -p "require('./package.json').version")"
git push origin "v$(node -p "require('./package.json').version")"
```

Optional local check before push:

```sh
npm run release:verify-tag -- "v$(node -p "require('./package.json').version")"
```

Pushing `v*` runs `release-tag.yml`, which:

1. Verifies tag ↔ `package.json` version
2. Upgrades npm CLI to **11.5.1** (required for OIDC; do **not** use `npm@latest` / npm 12 on Node 22.14)
3. Builds, warms fastembed, tests
4. Syncs plugins again
5. Zips Claude + Cursor plugin folders
6. Publishes via **OIDC** (strips setup-node `_authToken`; **no** `NODE_AUTH_TOKEN` on the publish step)
7. Verifies the version on the npm registry
8. Creates a GitHub Release with plugin zips + checksums
9. Optionally syncs plugin manifests back to default branch (secondary job; release job success is what matters)

## npm OIDC / 2FA (read before debugging publish)

### Preferred path — trusted publishing

1. On npmjs.com → `@yavdaanalytics/traceback` → **Trusted Publisher**:
   - Organization or user: `yavdaanalytics`
   - Repository: `traceback`
   - Workflow filename: `release-tag.yml` (filename only)
   - Environment: empty unless the workflow sets one
   - Allowed actions: include `npm publish`
2. Publishing access may be “Require 2FA **or** granular token with bypass 2fa” — OIDC still works.
3. Maintainer account 2FA via **security key** is fine — CI never prompts for the key when OIDC works.

### Workflow invariants (do not regress)

In `.github/workflows/release-tag.yml`:

- `permissions.id-token: write`
- `runs-on: ubuntu-latest` (GitHub-hosted only)
- Node `22.14.0` (npm trusted-publishing minimum)
- `npm install -g npm@11.5.1` before publish — **not** `npm@latest`
- Publish step must **not** set `NODE_AUTH_TOKEN` / `secrets.NPM_TOKEN`
- Before publish, delete `_authToken` lines from `$NPM_CONFIG_USERCONFIG` (setup-node writes a placeholder that skips OIDC and yields E404/ENEEDAUTH)

### Fallback — Bypass-2FA granular token

Only if OIDC is broken and the user asks for token publish:

1. Create granular token with package write + **Bypass two-factor authentication**
2. Put in `.env` as `npm_token=...` (never commit; never print)
3. `gh secret set NPM_TOKEN` — but restoring token-based CI requires workflow changes; prefer fixing OIDC instead
4. Validate with `npm whoami` before publish; a `401` means the token is dead

### Local interactive publish

`npm login` / `npm publish` will prompt for the security key. Use only for one-off unblock when the user explicitly requests it; prefer CI OIDC.

### After a failed tag

Do **not** force-move a published tag unless the user explicitly approves. Prefer a new patch (e.g. `0.1.3`) that includes the workflow fix, then push a new `v*` tag.

## Step 6 — Wait for CI

```sh
gh run list --workflow=release-tag.yml --limit 5
gh run watch
```

Treat the **`release` job** as the gate. `sync-plugin-manifests-back` may fail separately; if plugins were already synced in the release commit, that is non-blocking for npm/GitHub Release.

## Step 7 — Verify npm + release assets

```sh
npm run release:ensure-published -- --wait
gh release view "v$(node -p "require('./package.json').version")"
npm view @yavdaanalytics/traceback version
```

Expect:

- npm: `@yavdaanalytics/traceback@X.Y.Z` present
- GitHub Release files:
  - `claude-traceback-vX.Y.Z.zip`
  - `cursor-traceback-vX.Y.Z.zip`
  - `checksums.txt`

Do **not** casually run `npm run release:publish` from a laptop unless the user explicitly wants a manual publish and understands it can race CI.

## Step 8 — Marketplace handoff (yavda-marketplace)

Primary path: update the private org catalog
**https://github.com/yavdaanalytics/yavda-marketplace** (not zip upload to a public store).

1. After GitHub Release + npm succeed, follow [marketplace.md](marketplace.md):
   - Claude: bump `traceback` in `.claude-plugin/marketplace.json` (`version` + `source.sha` → release commit).
   - Cursor: copy `plugins/cursor-traceback/` → `yavda-marketplace/traceback/`, bump `.cursor-plugin/marketplace.json` `version`.
2. Commit + push `yavda-marketplace` when the user asks to publish the catalog.
3. Smoke-check: Claude `/plugin install traceback@yavda-tools` / Cursor refresh; then `traceback-setup --plugin --doctor`.
4. Report release URL, npm URL, and marketplace status (catalog updated / deferred / needs push).

Release zips remain secondary artifacts; see [marketplace.md](marketplace.md).

## Done criteria

Release is complete only when all of these are true (or marketplace explicitly deferred by the user):

| Channel | Done when |
|---------|-----------|
| OSS GitHub | `main` pushed; tag `vX.Y.Z` on origin |
| npm | `release:ensure-published` ok |
| GitHub Release | release exists with both plugin zips |
| Claude marketplace | `yavda-marketplace` Claude entry updated (or user deferred) |
| Cursor marketplace | `yavda-marketplace` Cursor entry + vendored `traceback/` synced (or user deferred) |

## Quick command block (after version bump committed)

```sh
git push origin main
git tag "v$(node -p "require('./package.json').version")"
git push origin "v$(node -p "require('./package.json').version")"
gh run watch
npm run release:ensure-published -- --wait
gh release view "v$(node -p "require('./package.json').version")"
```
