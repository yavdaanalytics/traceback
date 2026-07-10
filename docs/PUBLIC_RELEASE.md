# Public OSS release checklist

Manual steps before publishing this repository publicly under MIT license.

## Repository hygiene

- [ ] **Git history scrub** — If internal files (`ROADMAP.md`, `PROMPT.md`, `deploy/droplet/`, etc.) were ever committed, run `git filter-repo` or publish from a clean branch without that history. `.gitignore` does not remove past commits.
- [ ] **Verify `.gitignore`** — Confirm internal paths are ignored and untracked (`data/`, `dist/`, `.traceback/`, `.env`, local MCP configs).
- [ ] **Copyright** — Confirm [`LICENSE`](../LICENSE) copyright holder name is correct.

## Infrastructure

- [ ] **Collector live** — Ensure `https://traceback.yavda.com` serves `traceback-metrics` before plugin default endpoint ships. See [`deploy/README.md`](../deploy/README.md) for self-host instructions.
- [ ] **Privacy review** — Plugin installs default sharing ON with disclosure; confirm this meets your jurisdiction.
- [x] **GitHub Security** — `SECURITY.md`, private vulnerability reporting, secret scanning (+ push protection), Dependabot alerts/security updates, CodeQL workflow, `.github/dependabot.yml`. Skip “Code quality findings” unless you want the extra noise.

## Publishing

- [ ] **GitHub** — Create or open public repo: https://github.com/yavdaanalytics/traceback
- [ ] **npm** — Package is `@yavdaanalytics/traceback` (unscoped `traceback` is taken). Set repo secret `NPM_TOKEN` to an npm **granular access token** with:
  - Permission: **Read and write** for packages (or publish on `@yavdaanalytics`)
  - **Bypass two-factor authentication** enabled (required for CI `npm publish`)
  - Then tag `v*` to trigger [`.github/workflows/release-tag.yml`](../.github/workflows/release-tag.yml). `prepublishOnly` warms fastembed, then runs `build` + serialized `test` before every `npm publish`.
- [ ] **Verify publish** — `npm run release:ensure-published` (add `--wait` after CI). Exit 1 means the version is not on the registry yet.

### If release CI fails before publish (package 404)

The tag workflow never reached a successful `npm publish`. Fix programmatically:

```sh
# 1. Confirm missing + classify
npm run release:ensure-published

# 2. If CI failed on tests: land the fix, then retarget the same semver tag
git push origin main
git tag -f "v$(node -p "require('./package.json').version")" HEAD
git push origin ":refs/tags/v$(node -p "require('./package.json').version")"
git push origin "v$(node -p "require('./package.json').version")"

# 3. If CI failed on publish with E403 / "bypass 2fa":
#    create a granular npm token with bypass-2FA, then:
gh secret set NPM_TOKEN -R yavdaanalytics/traceback < token.txt
gh workflow run release-tag.yml --ref "v$(node -p "require('./package.json').version")"

# 4. Re-check:
npm run release:ensure-published -- --wait
```

Do **not** bump the package version solely because a tag publish failed — move the existing `v*` tag to the fixed SHA (or re-run the workflow on that tag) instead.

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
