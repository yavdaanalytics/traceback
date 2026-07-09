# Development & quality gates

Contributor quick reference. Stack and conventions: [`CLAUDE.md`](../CLAUDE.md).

## Commands

```sh
npm run build                 # compile TypeScript → dist/
npm test                      # full suite (unit, integration, e2e, regression, evals, security, contracts)
npm run bench                 # performance benchmarks with SLA gates (requires build first)
npm run security:sast         # Semgrep (requires `pip install semgrep`)
npm run security:audit        # npm audit
traceback-dashboard           # http://127.0.0.1:5555
traceback-telemetry status
traceback-metrics             # self-hosted Phase 3 collector
```

## Security gates

1. **Prompt injection** (`tests/security/prompt-injection.test.ts`): git option injection, shell metacharacters, transcript path traversal, LanceDB filter escaping. Defense: `execFileSync` with argv arrays — never interpolate user input into shell strings.

2. **Security invariants** (`tests/regression/security-invariants.test.ts`): source scan — fails if any `src/**/*.ts` uses `exec()`, `shell: true`, or interpolated `execFileSync` argv elements.

3. **Tool schema contracts** (`tests/contract/`): backwards-compatibility for MCP signatures. New tools: update `docs/API.md`. Do not add required fields without migration plan.

## Bench SLA budgets

CI-gated in `scripts/bench.mjs` (`npm run bench` after `npm run build`):

| Benchmark | p95 | p99 |
|-----------|-----|-----|
| `sqlite-insert` | ≤ 20ms | ≤ 50ms |
| `sqlite-query` (10k rows) | ≤ 200ms | ≤ 250ms |
| `lancedb-search` (1k) | ≤ 100ms | ≤ 150ms |
| `lancedb-search` (5k/10k) | ≤ 150ms | ≤ 200ms |
| `commit-embeddings-search` | ≤ 150ms | ≤ 200ms |

## Test layout

See **Testing** section in [`CLAUDE.md`](../CLAUDE.md).

### Testing contract (strict)

| Layer | Location | Rules |
|-------|----------|-------|
| Unit | `tests/unit/` | Mocks OK; adversarial fixtures for DB readers (NULL blobs, malformed JSON) |
| Integration | `tests/integration/` | Real adapters via `TRACEBACK_*_STORAGE` temp dirs; no `registry` vi.mock |
| E2E | `tests/e2e/` | Full hook → ingest → recall; assert sqlite rows and hook log, not just no-throw |
| Regression | `tests/regression/` | Pin previously-shipped bugs by name |

Cursor agent rules: [`.cursor/rules/testing.mdc`](../.cursor/rules/testing.mdc).

CI: `.github/workflows/test.yml` runs `npm test` on push/PR.
