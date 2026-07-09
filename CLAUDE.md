# CLAUDE.md — traceback

Semantic debugger MCP server: warm-starts grep/git with cosine-similarity recall
over past coding-agent sessions, so an LLM agent scopes searches instead of
grepping the whole repo blind.

## Documentation layering (required)

Follow [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) whenever you add or edit user-facing text.

| Tier | Files | Your job |
|------|-------|----------|
| Front door | `README.md` | Value prop, quick start, funnel one-liner, privacy defaults, doc map only — no API tables or hook details |
| Task guides | `SETUP.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/TELEMETRY.md`, `SKILL.md` | Put install steps, tool reference, architecture depth, telemetry schema here |
| Contributor | `CLAUDE.md`, `docs/DEV.md` | Stack, tests, security, bench SLAs |

When you add an MCP tool: wire `src/mcp/index.ts`, update `tests/contract/`, and **`docs/API.md`** (not README).
When you change install/hooks: **`SETUP.md`** (not README).
`ROADMAP*.md` is gitignored — keep internal planning local; never link from public docs.
Open source does not hide implementation — layer docs for clarity, not secrecy.

## Stack (as it actually exists in this repo — do not add to this without checking package.json first)
- **Runtime**: Node >=22.5.0, TypeScript, ESM (`"type": "module"`), compiled via `tsc` (`npm run build`).
- **MCP transport**: `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`), tools registered via `server.registerTool(name, {description, inputSchema: zod}, handler)`.
- **Relational/graph storage**: Node's built-in `node:sqlite` (`DatabaseSync`) — chosen over `better-sqlite3` to avoid native-binary/build-toolchain friction on Windows. Schema lives in `src/storage/sqlite.ts` as a single `CREATE TABLE IF NOT EXISTS` string; new columns on existing tables need a guarded `PRAGMA table_info` + `ALTER TABLE` migration (`CREATE TABLE IF NOT EXISTS` alone won't add columns).
- **Vector storage**: `@lancedb/lancedb`, embedded, **cosine** ANN search via `.distanceType("cosine")` on every vector query. `_distance` is ascending cosine distance (lower = more similar, range ~0–2). Default `TRACEBACK_CONFIDENCE_THRESHOLD` is **0.35** (cosine scale).
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
- `src/storage/sqlite.ts`: typed row interfaces + hand-written prepared statements with `$named` params, plain exported `upsertX`/`getX` functions, `getDb(dbPath)` caches one connection per resolved path (a `Map`, not a single singleton) so a process can hold multiple repos' DBs open at once — used by `traceback-dashboard` to aggregate telemetry across repos (`src/dashboard/registry.ts` tracks known repos in `~/.traceback/repos.json`).
- ESM imports of local compiled output on Windows require the `file://` URL scheme (bare `c:/...` paths throw `ERR_UNSUPPORTED_ESM_URL_SCHEME`).

## Testing
Test runner: **Vitest** (`npm test` runs everything under `tests/`). Layout:
- `tests/unit/` — `src/storage/sqlite.ts`, `src/mcp/telemetry.ts`, `src/mcp/feedback.ts` in isolation, each file against its own temp SQLite DB.
- `tests/integration/` — real `fastembed` embeddings + real LanceDB search + SQLite penalty lookup together (`rank-with-penalty.test.ts`), against an isolated temp data dir — never the real `data/`.
- `tests/e2e/` — spawns the actual compiled server (`dist/mcp/index.js`) and drives it over real stdio JSON-RPC (`tests/e2e/mcp-server.test.ts`), the same protocol every host speaks. Requires `npm run build` first.
- `tests/regression/` — pins behaviors a "helpful" refactor could silently invert: the penalty sign convention (add, never subtract), the `penalty_weight` migration, exact efficiency-report phrasing, and a source-scan guard (`security-invariants.test.ts`) that fails if any `src/**/*.ts` file calls `exec()`/`shell: true` or string-interpolates into an `execFileSync` argv element.
- `tests/evals/` — scripted, deterministic (no LLM call) checks of the agent-facing contract: recall@1 on a golden query/session set, warm-start line-reduction % on a synthetic noisy repo, and that `submit_feedback`'s HITL usage-contract text is still present verbatim in `src/mcp/index.ts`.

**Important — `node:sqlite`/LanceDB singleton caveat**: `getConnection()` in `lancedb.ts` still caches its handle keyed on the *first* dir passed to it per process; a second call with a different dir in the same process silently reuses the first connection. `getDb()` in `sqlite.ts` no longer has this limitation — it caches per resolved path in a `Map`, so multiple SQLite paths can be open at once in one process (this is what lets the dashboard aggregate across repos). LanceDB test files must still use exactly one dir for their own duration — this works today because Vitest's default pool runs each test file in an isolated worker/module registry. Don't multiplex LanceDB dirs within a single test file.

Other checks:
- `npm run bench` (`scripts/bench.mjs`, run after `npm run build`) — latency/throughput of `sqlite` writes/reads and LanceDB search at 1k/5k/10k-row scale. SLA thresholds and security gate summary: [`docs/DEV.md`](docs/DEV.md). Not classic load testing (this is a single-user local stdio process, not a concurrent network service) — it answers "does this stay fast as history grows."
- `npm run security:sast` — runs [Semgrep](https://semgrep.dev) (`--config auto --config p/command-injection`) against `src/`. Semgrep itself is a **system-level `pip install semgrep`**, not an npm devDependency — install it once per machine, it's not vendored in `node_modules`.
- `npm run security:audit` — `npm audit` for dependency vulnerabilities. Known finding: `fastembed`'s pinned `tar` transitive dependency has published advisories; the only fix available is downgrading `fastembed` to `1.0.0` (breaking) — left as-is pending a real fastembed upgrade, not silently force-fixed.
- No DAST — `traceback` is a local stdio MCP server with no network listener, so HTTP-facing DAST tooling (ZAP, etc.) doesn't apply.

## Out of scope / deliberately unwired
- The "Episode" hierarchical session model is deferred, not v1.
