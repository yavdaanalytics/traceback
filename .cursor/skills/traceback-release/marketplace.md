# Marketplace handoff (manual)

After `release-tag.yml` succeeds, plugin zips are on the GitHub Release. Marketplace
stores are **outside** CI — a human (or agent with the user's marketplace credentials/UI)
must submit or update the listing.

## Artifacts

From `https://github.com/yavdaanalytics/traceback/releases/tag/vX.Y.Z`:

| File | Package root |
|------|----------------|
| `claude-traceback-vX.Y.Z.zip` | `plugins/claude-traceback/` (manifest: `.claude-plugin/plugin.json`) |
| `cursor-traceback-vX.Y.Z.zip` | `plugins/cursor-traceback/` (manifest: `.cursor-plugin/plugin.json`) |

Verify checksums against `checksums.txt` on the same release when available.

## Claude Code marketplace

1. Open Anthropic's Claude Code / Claude plugin marketplace publisher flow (org account that owns the Traceback listing).
2. Create a new version or update the existing **traceback** plugin.
3. Upload `claude-traceback-vX.Y.Z.zip` (or point the listing at the release asset URL if the flow supports URL sources).
4. Confirm manifest fields match the zip: `name`, `version`, `skills`, `hooks`, `mcpServers`.
5. Submit / publish the listing update.
6. Smoke-check: install/update in Claude Code → run
   `npx -y -p @yavdaanalytics/traceback traceback-setup --plugin --doctor` (or host equivalent).

Plugin install docs for users: `plugins/claude-traceback/README.md`.

## Cursor marketplace

1. Open Cursor's plugin marketplace / publisher flow for the Traceback listing.
2. Create a new version or update the existing **traceback** plugin.
3. Upload `cursor-traceback-vX.Y.Z.zip` (or attach the release asset if supported).
4. Confirm manifest fields match the zip: `name`, `version`, `skills`, `rules`, `hooks`, `mcpServers`.
5. Submit / publish the listing update.
6. Smoke-check: install/update in Cursor → Customize → Plugins → run
   `npx -y -p @yavdaanalytics/traceback traceback-setup --plugin --doctor`.

Plugin install docs for users: `plugins/cursor-traceback/README.md`.

## If marketplace UI is unavailable

- Leave marketplace status as **deferred** in the release report.
- Give the user the two zip URLs from the GitHub Release.
- Do not invent CLI publish commands that are not documented in this repo.

## Agent notes

- Prefer guiding the user through the publisher UI over storing marketplace secrets in the repo.
- Never commit marketplace API tokens into git.
- Version in both plugin manifests must equal `package.json` version (ensured by `npm run release:sync-plugins` / CI).
