---
name: traceback-release
description: >-
  Cut a traceback maintainer release to the public OSS GitHub repo, npm
  (@yavdaanalytics/traceback), and Claude/Cursor plugin artifacts. Use when the
  user asks to release, publish, cut a version, bump and tag, push a v* tag,
  publish to npm, update the Claude marketplace plugin, or update the Cursor
  marketplace plugin.
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
- Claude/Cursor **marketplace listing** is manual after the GitHub Release exists — CI only attaches plugin zips.

## Progress checklist

Copy and update as you go:

```
Release Progress:
- [ ] 0. Confirm intent + version bump type
- [ ] 1. Preflight (clean tree, on main, tests)
- [ ] 2. Bump package.json version + sync plugins
- [ ] 3. Commit version/plugin sync
- [ ] 4. Push main to origin (OSS)
- [ ] 5. Create and push v* tag
- [ ] 6. Wait for release-tag workflow
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

1. Bump `"version"` in `package.json` (and keep `package-lock.json` in sync if npm rewrites it).
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
2. Builds, warms fastembed, tests
3. Syncs plugins again
4. Zips Claude + Cursor plugin folders
5. Publishes `@yavdaanalytics/traceback` to npm via **OIDC trusted publishing** (no `NODE_AUTH_TOKEN`; workflow upgrades npm CLI and strips setup-node `_authToken` so OIDC is not skipped). `NPM_TOKEN` is not used on the publish step.
6. Creates a GitHub Release with plugin zips + checksums
7. Commits plugin manifest sync back to default branch if needed

## Step 6 — Wait for CI

```sh
gh run list --workflow=release-tag.yml --limit 5
gh run watch
```

Or open the Actions tab for the tag push.

## Step 7 — Verify npm + release assets

```sh
npm run release:ensure-published -- --wait
gh release view "v$(node -p "require('./package.json').version")"
```

Expect:

- npm: `@yavdaanalytics/traceback@X.Y.Z` present
- GitHub Release files:
  - `claude-traceback-vX.Y.Z.zip`
  - `cursor-traceback-vX.Y.Z.zip`
  - `checksums.txt`

### npm publish failures

If CI publish fails with 2FA / auth errors, follow the remediation printed by `scripts/publish-npm.mjs` (granular npm token with Bypass 2FA → `gh secret set NPM_TOKEN` → re-run workflow). Prefer fixing trusted publishing / OIDC long-term.

Do **not** casually run `npm run release:publish` from a laptop unless the user explicitly wants a manual publish and understands it can race CI.

## Step 8 — Marketplace handoff

CI does **not** submit to Claude or Cursor marketplaces. After the GitHub Release exists:

1. Download both plugin zips from the release.
2. Follow [marketplace.md](marketplace.md) for Claude Code and Cursor submission.
3. Report back to the user with release URL, npm URL, and marketplace status (submitted / blocked / needs human login).

## Done criteria

Release is complete only when all of these are true (or marketplace explicitly deferred by the user):

| Channel | Done when |
|---------|-----------|
| OSS GitHub | `main` pushed; tag `vX.Y.Z` on origin |
| npm | `release:ensure-published` ok |
| GitHub Release | release exists with both plugin zips |
| Claude marketplace | listing updated (or user deferred) |
| Cursor marketplace | listing updated (or user deferred) |

## Quick command block (after version bump committed)

```sh
git push origin main
git tag "v$(node -p "require('./package.json').version")"
git push origin "v$(node -p "require('./package.json').version")"
npm run release:ensure-published -- --wait
gh release view "v$(node -p "require('./package.json').version")"
```
