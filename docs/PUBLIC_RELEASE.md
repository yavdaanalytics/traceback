# Public OSS release checklist

Manual steps before publishing this repository publicly under MIT license.

## Repository hygiene

- [x] **Git history scrub** — Removed from history: `ROADMAP.md`, `PROMPT.md`, `IMPLEMENTATION_*`, `INSTALLATION_TEST.md`, `QUICKSTART_ENHANCEMENTS.md`, `TOKEN_REDUCTION_IMPLEMENTATION.md`, `TUNING_PLAYBOOK.md`, `SETUP_AUTOMATION_SUMMARY.md`, `.mcp.json`, `.vscode/mcp.json`. Force-pushed rewritten `main` + tags.
- [x] **Verify `.gitignore`** — Internal paths ignored (`data/`, `dist/`, `.traceback/`, `.env`, local MCP configs).
- [x] **Copyright** — [`LICENSE`](../LICENSE) holder: Yavda Analytics (2026).

## Infrastructure

- [x] **Collector live** — `https://traceback.yavda.com` serves public metrics / collector API (+ `/privacy`).
- [x] **Privacy review** — Defaults documented in [`docs/PRIVACY.md`](PRIVACY.md); plain setup OFF, plugin ON with disclosure; rollups exclude queries/paths/transcripts/PII. Confirm org policy before mandating `--plugin`.
- [x] **GitHub Security** — `SECURITY.md`, private vulnerability reporting, secret scanning (+ push protection), Dependabot alerts/security updates, CodeQL workflow, `.github/dependabot.yml`.
- [x] **Community health** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, issue/PR templates, `CODEOWNERS` (`@yavdatech`).
- [x] **Repo hygiene settings** — delete branch on merge; Projects off; Discussions on; Wiki off.

## Publishing

- [x] **GitHub** — Public repo: https://github.com/yavdaanalytics/traceback
- [x] **npm** — `@yavdaanalytics/traceback@0.1.0` published: https://www.npmjs.com/package/@yavdaanalytics/traceback
- [x] **Verify publish** — `npm run release:ensure-published` returns `ok: true`.
- [x] **Trusted publishing** — Configured for GitHub Actions (`yavdaanalytics` / `traceback` / `release-tag.yml`, allow `npm publish`). CI Node **22.14.0+**, npm CLI **≥ 11.5.1** (workflow upgrades npm before publish). Optional next: set Publishing access to disallow tokens and revoke bypass-2FA `NPM_TOKEN` after the next OIDC release succeeds.

### OIDC GitHub Actions checklist (after npm Trusted Publisher UI)

npm UI alone is not enough — the workflow must match. This repo’s [`.github/workflows/release-tag.yml`](../.github/workflows/release-tag.yml) already has:

1. `permissions.id-token: write` (required for OIDC)
2. `runs-on: ubuntu-latest` (GitHub-hosted; self-hosted is unsupported)
3. `npm install -g npm@11.5.1` before publish (needs CLI ≥ 11.5.1; avoid `npm@latest` / npm 12 on Node 22.14)
4. Publish step **without** `NODE_AUTH_TOKEN` (classic tokens block OIDC when empty/invalid)
5. Strips setup-node’s `_authToken=` line from the runner npmrc before `npm publish`

On npmjs.com → `@yavdaanalytics/traceback` → **Trusted Publisher**, confirm:

| Field | Value |
|-------|--------|
| Organization or user | `yavdaanalytics` |
| Repository | `traceback` |
| Workflow filename | `release-tag.yml` (filename only) |
| Environment | leave empty unless the workflow sets one |
| Allowed actions | include `npm publish` |

Then publish the already-tagged release:

```sh
# merge the OIDC workflow fix to main first, then:
gh workflow run release-tag.yml --ref v0.1.1
npm run release:ensure-published -- --wait
```

Only after a successful OIDC publish: switch Publishing access to “disallow tokens” and delete unused automation tokens.
- [x] **GitHub Release** — https://github.com/yavdaanalytics/traceback/releases/tag/v0.1.0 (plugin zips attached)
- [x] **npm package contents** — `package.json` `files` allowlist ships `dist`, `SKILL.md`, `SETUP.md`, and license/docs (not the full test tree).

### Future releases

Agent-driven checklist (OSS → npm → GitHub Release → Claude/Cursor marketplace handoff):
[`.cursor/skills/traceback-release/SKILL.md`](../.cursor/skills/traceback-release/SKILL.md).

```sh
# bump package.json version, then:
git tag "v$(node -p "require('./package.json').version")"
git push origin "v$(node -p "require('./package.json').version")"
npm run release:ensure-published -- --wait
```

## After clone (maintainers)

```sh
npm ci
npm run build
npx -y -p @yavdaanalytics/traceback traceback-setup --plugin   # per repo; merges telemetry env into MCP config
```

## Opt-out reference (for users)

- During setup: answer `n` at the sharing prompt
- Anytime: `traceback-telemetry disable`
- Manual uploads only: `traceback-telemetry auto-upload off`

Full policy: [`docs/TELEMETRY.md`](TELEMETRY.md)
