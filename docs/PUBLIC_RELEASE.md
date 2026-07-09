# Public OSS release checklist

Manual steps before publishing this repository publicly under MIT license.

## Repository hygiene

- [ ] **Git history scrub** — If internal files (`ROADMAP.md`, `PROMPT.md`, `deploy/droplet/`, etc.) were ever committed, run `git filter-repo` or publish from a clean branch without that history. `.gitignore` does not remove past commits.
- [ ] **Verify `.gitignore`** — Confirm internal paths are ignored and untracked (`data/`, `dist/`, `.traceback/`, `.env`, local MCP configs).
- [ ] **Copyright** — Confirm [`LICENSE`](../LICENSE) copyright holder name is correct.

## Infrastructure

- [ ] **Collector live** — Ensure `https://traceback.yavda.com` serves `traceback-metrics` before plugin default endpoint ships. See [`deploy/README.md`](../deploy/README.md) for self-host instructions.
- [ ] **Privacy review** — Plugin installs default sharing ON with disclosure; confirm this meets your jurisdiction.

## Publishing

- [ ] **GitHub** — Create or open public repo: https://github.com/yavdaanalytics/traceback
- [ ] **npm** — Add `NPM_TOKEN` to GitHub Actions secrets; tag `v*` to trigger [`.github/workflows/release-tag.yml`](../.github/workflows/release-tag.yml)
- [ ] **Plugin marketplaces** — Upload release zips (`claude-traceback-*.zip`, `cursor-traceback-*.zip`) from GitHub Releases to Cursor and Claude plugin distribution flows

## After clone (maintainers)

```sh
npm ci
npm run build
npx traceback-setup --plugin   # per repo; merges telemetry env into MCP config
```

## Opt-out reference (for users)

- During setup: answer `n` at the sharing prompt
- Anytime: `traceback-telemetry disable`
- Manual uploads only: `traceback-telemetry auto-upload off`

Full policy: [`docs/TELEMETRY.md`](TELEMETRY.md)
