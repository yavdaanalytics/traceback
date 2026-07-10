# Public OSS release checklist

Manual steps before publishing this repository publicly under MIT license.

## Repository hygiene

- [ ] **Git history scrub** — If internal files (`ROADMAP.md`, `PROMPT.md`, `deploy/droplet/`, etc.) were ever committed, run `git filter-repo` or publish from a clean branch without that history. `.gitignore` does not remove past commits. (Skip if history is already clean for public release.)
- [x] **Verify `.gitignore`** — Internal paths ignored (`data/`, `dist/`, `.traceback/`, `.env`, local MCP configs).
- [x] **Copyright** — [`LICENSE`](../LICENSE) holder: Yavda Analytics (2026).

## Infrastructure

- [x] **Collector live** — `https://traceback.yavda.com` serves public metrics / collector API.
- [ ] **Privacy review** — Plugin installs default sharing ON with disclosure; confirm this meets your jurisdiction.
- [x] **GitHub Security** — `SECURITY.md`, private vulnerability reporting, secret scanning (+ push protection), Dependabot alerts/security updates, CodeQL workflow, `.github/dependabot.yml`.
- [x] **Community health** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, issue/PR templates, `CODEOWNERS` (`@yavdatech`).
- [x] **Repo hygiene settings** — delete branch on merge; Projects off; Discussions on; Wiki off.

## Publishing

- [x] **GitHub** — Public repo: https://github.com/yavdaanalytics/traceback
- [x] **npm** — `@yavdaanalytics/traceback@0.1.0` published: https://www.npmjs.com/package/@yavdaanalytics/traceback
- [x] **Verify publish** — `npm run release:ensure-published` returns `ok: true`.
- [ ] **Trusted publishing** — On the npm package → Trusted Publisher → GitHub Actions:
  - Org/user: `yavdaanalytics`
  - Repo: `traceback`
  - Workflow: `release-tag.yml`
  - Allowed action: **Allow npm publish**
  - CI Node is **22.14.0+** (required for OIDC). After a successful Actions publish, optionally set Publishing access to disallow tokens and revoke the bypass-2FA `NPM_TOKEN`.
- [x] **GitHub Release** — https://github.com/yavdaanalytics/traceback/releases/tag/v0.1.0 (plugin zips attached)
- [x] **npm package contents** — `package.json` `files` allowlist ships `dist`, `SKILL.md`, `SETUP.md`, and license/docs (not the full test tree).

### Future releases

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
