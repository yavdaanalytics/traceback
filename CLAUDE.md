# CLAUDE.md — traceback

Semantic debugger MCP server: warm-starts grep/git with cosine-similarity recall
over past coding-agent sessions, so an LLM agent scopes searches instead of
grepping the whole repo blind.

## Stack (as it actually exists in this repo — do not add to this without checking package.json first)
- **Runtime**: Node >=22.5.0, TypeScript, ESM (`"type": "module"`), compiled via `tsc` (`npm run build`).
- **MCP transport**: `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`), tools registered via `server.registerTool(name, {description, inputSchema: zod}, handler)`.
- **Relational/graph storage**: Node's built-in `node:sqlite` (`DatabaseSync`) — chosen over `better-sqlite3` to avoid native-binary/build-toolchain friction on Windows. Schema lives in `src/storage/sqlite.ts` as a single `CREATE TABLE IF NOT EXISTS` string; new columns on existing tables need a guarded `PRAGMA table_info` + `ALTER TABLE` migration (`CREATE TABLE IF NOT EXISTS` alone won't add columns).
- **Vector storage**: `@lancedb/lancedb`, embedded, cosine/L2 ANN search. Default `.search()` metric is **ascending L2 distance** (`_distance` field, lower = more similar) — no `.metricType()` call exists in `src/storage/lancedb.ts`, so treat it as distance, not similarity, anywhere you touch ranking.
- **Embeddings**: `fastembed` (`all-MiniLM-L6-v2`), local, free, no LLM API call.
- **Validation**: `zod` for MCP tool input schemas.
- **No logging library** is installed.
- **Testing**: `vitest` (devDependency) — see Testing below for what's covered.

## Hard security rule
Every git/grep shell-out **must** use `execFileSync(cmd, argvArray, {cwd, encoding})` —
never a string-interpolated shell command. This prevents command injection since
tool inputs (queries, patterns, refs) can come from LLM-generated arguments.

## Conventions
- Business logic lives in its own `src/mcp/*.ts` module (e.g. `search.ts`, `lineage.ts`, `telemetry.ts`, `feedback.ts`); `src/mcp/index.ts` only wires `server.registerTool(...)` to those functions — no logic inline in the wiring file.
- `src/storage/sqlite.ts`: typed row interfaces + hand-written prepared statements with `$named` params, plain exported `upsertX`/`getX` functions, `getDb(dbPath)` singleton.
- ESM imports of local compiled output on Windows require the `file://` URL scheme (bare `c:/...` paths throw `ERR_UNSUPPORTED_ESM_URL_SCHEME`).

## Testing
Test runner: **Vitest** (`npm test` runs everything under `tests/`). Layout:
- `tests/unit/` — `src/storage/sqlite.ts`, `src/mcp/telemetry.ts`, `src/mcp/feedback.ts` in isolation, each file against its own temp SQLite DB.
- `tests/integration/` — real `fastembed` embeddings + real LanceDB search + SQLite penalty lookup together (`rank-with-penalty.test.ts`), against an isolated temp data dir — never the real `data/`.
- `tests/e2e/` — spawns the actual compiled server (`dist/mcp/index.js`) and drives it over real stdio JSON-RPC (`tests/e2e/mcp-server.test.ts`), the same protocol every host speaks. Requires `npm run build` first.
- `tests/regression/` — pins behaviors a "helpful" refactor could silently invert: the penalty sign convention (add, never subtract), the `penalty_weight` migration, exact efficiency-report phrasing, and a source-scan guard (`security-invariants.test.ts`) that fails if any `src/**/*.ts` file calls `exec()`/`shell: true` or string-interpolates into an `execFileSync` argv element.
- `tests/evals/` — scripted, deterministic (no LLM call) checks of the agent-facing contract: recall@1 on a golden query/session set, warm-start line-reduction % on a synthetic noisy repo, and that `submit_feedback`'s HITL usage-contract text is still present verbatim in `src/mcp/index.ts`.

**Important — `node:sqlite`/LanceDB singleton caveat**: `getDb()` in `sqlite.ts` and `getConnection()` in `lancedb.ts` both cache their handle keyed on the *first* path/dir passed to them per process; a second call with a different path in the same process silently reuses the first connection. Each test file must therefore use exactly one SQLite path and one LanceDB dir for its own duration — this works today because Vitest's default pool runs each test file in an isolated worker/module registry. Don't multiplex sqlite/lancedb paths within a single test file.

Other checks:
- `npm run bench` (`scripts/bench.mjs`, run after `npm run build`) — latency/throughput of `sqlite` writes/reads and LanceDB search at 1k/5k/10k-row scale. Not classic load testing (this is a single-user local stdio process, not a concurrent network service) — it answers "does this stay fast as history grows."
- `npm run security:sast` — runs [Semgrep](https://semgrep.dev) (`--config auto --config p/command-injection`) against `src/`. Semgrep itself is a **system-level `pip install semgrep`**, not an npm devDependency — install it once per machine, it's not vendored in `node_modules`.
- `npm run security:audit` — `npm audit` for dependency vulnerabilities. Known finding: `fastembed`'s pinned `tar` transitive dependency has published advisories; the only fix available is downgrading `fastembed` to `1.0.0` (breaking) — left as-is pending a real fastembed upgrade, not silently force-fixed.
- No DAST — `traceback` is a local stdio MCP server with no network listener, so HTTP-facing DAST tooling (ZAP, etc.) doesn't apply.

## Out of scope / deliberately unwired
- `src/git/commit-window.ts` (`getCommitWindow`, N-before/M-after logic) exists but is not called from anywhere — confirmed dead code, not a bug.
- The "Episode" model mentioned in `ROADMAP.md` is deferred, not v1.
