# Contributing to traceback

Thanks for helping improve traceback. This guide covers the practical path from clone → PR.

## Before you start

1. Read [`CLAUDE.md`](CLAUDE.md) (stack, conventions, testing).
2. Follow [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) when editing user-facing docs.
3. Security reports go through [`SECURITY.md`](SECURITY.md) — **not** public issues.
4. By participating, you agree to the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Development setup

```sh
git clone https://github.com/yavdaanalytics/traceback.git
cd traceback
npm ci
npm run build
npm test
```

Node **≥ 22.5.0** is required (`engines` in `package.json`).

Useful commands: [`docs/DEV.md`](docs/DEV.md).

## What to work on

- Bugs and clear gaps filed as issues
- Docs fixes (especially `SETUP.md`, `docs/API.md`, `docs/ARCHITECTURE.md`)
- Adapter / ingest / MCP tool improvements with tests

Avoid large refactors or new product surfaces without an issue first.

## Pull request process

1. Branch from `main`.
2. Keep changes focused — one concern per PR.
3. Add or update tests when changing `src/` (see testing contract in [`docs/DEV.md`](docs/DEV.md)).
4. Run locally before opening the PR:

   ```sh
   npm run build
   npm test
   ```

5. Fill out the PR template. Link related issues.
6. Do not commit secrets, `.env`, `data/`, or local IDE MCP configs.

CI runs `.github/workflows/test.yml` on every PR. Branch protection requires the `test` check.

## Documentation changes

| Change | Update |
|--------|--------|
| New MCP tool | `src/mcp/index.ts`, `tests/contract/`, `docs/API.md` |
| Install / hooks | `SETUP.md` |
| Telemetry defaults | `docs/TELEMETRY.md` + README defaults table only |
| Architecture / funnel | `docs/ARCHITECTURE.md` |

Do not expand `README.md` with API tables or hook details.

## Release note

Maintainers cut releases by tagging `v*` (see [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md)). Contributors do not need to bump versions unless asked.

## Questions

- Product / usage: [GitHub Discussions](https://github.com/yavdaanalytics/traceback/discussions)
- Bugs / features: [Issues](https://github.com/yavdaanalytics/traceback/issues)
- How to get help: [`SUPPORT.md`](SUPPORT.md)
