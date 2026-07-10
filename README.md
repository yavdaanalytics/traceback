# traceback

Semantic debugger MCP server: helps LLM agents find the right code *fast* by warming up grep with embedding-based context recall — turning a blind O(repo) search into a scoped O(session) search.

## Quick start

```sh
git clone https://github.com/yavdaanalytics/traceback.git
cd traceback
npm install
npm run build
npx -y -p @yavdaanalytics/traceback traceback-setup
```

Or from npm (after publish): `npm install -g @yavdaanalytics/traceback` then `traceback-setup`.

`npm install` does **not** run setup automatically. For global all-repo setup, plugin installs, and per-IDE hooks, see [`SETUP.md`](SETUP.md).

**First MCP call for coding tasks:** `search_with_fallback` with the user's question and repo path. Full tool list: [`docs/API.md`](docs/API.md).

## How it works

traceback **sequences** fuzzy recall before precise search via a 4-layer funnel (`search_with_fallback`):

```
Query → L1 session cosine (optional) → L2 git pickaxe + intent → L3 scoped grep (widens if empty) → L4 refinements
```

| Layer | What | Always runs? |
|-------|------|--------------|
| **L1** | Past session embeddings (LanceDB) | Attempted; may be empty on cold start |
| **L2** | `git log -S` + commit-message embeddings | Yes |
| **L3** | Scoped `git grep` → widen to full repo | Yes |
| **L4** | Symbol / diff / keyword refinements | Partial |

Deep dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Indexing & backfill

- **Global hook, per-repo data** — setup installs one post-commit hook at `~/.traceback/hooks` (`git config --global core.hooksPath`). A commit in **any** repo triggers ingest scoped to **that** repo only.
- **Not a machine-wide index** — SQLite + LanceDB live under each repo's `data/` (`traceback.db`, `lancedb/`). Adapters read IDE transcript folders (`~/.claude/projects`, `~/.cursor/projects`, `~/.copilot/session-state`, etc.) but only sessions whose workspace path matches the committing repo are indexed.
- **Lazy backfill** — nothing is bulk-scanned on install. The first commit in a repo (or `traceback-ingest --repo <path>`) backfills matching sessions from Claude Code, Cursor, and Copilot. Full paths, env overrides, and non-blocking hooks: [`SETUP.md`](SETUP.md) §6.

## Why it matters

- **Speed** — search hundreds of scoped lines instead of tens of thousands.
- **Recall** — semantic match finds "token expiry" when you said "jwt timeout".
- **Tokens** — fewer noisy grep hits means the agent can read all matches.

**Real-world proof (private production repo):** query *"CIAM authentication tenant isolation"* — blind `git grep` returned **10,542 lines** (~300K tokens); traceback scoped warm-start returned **107 lines** (~3.2K tokens), **99% noise cut** on a cold start (no indexed sessions). Write-up: [`actual_codebase_measures/powerbi-embedded-analytics-ciam-search.md`](actual_codebase_measures/powerbi-embedded-analytics-ciam-search.md). Redacted telemetry: [`fixtures/powerbi-ciam-proof/invocation-1.json`](fixtures/powerbi-ciam-proof/invocation-1.json). Re-run locally: `npm run build && npm run proof:powerbi` (needs a local checkout; `--repo` or `TRACEBACK_PROOF_REPO`).

Embeddings run **locally** (`fastembed`, no LLM API). LanceDB + SQLite + git — no database server.

## Privacy & telemetry

Local metrics always land in `data/traceback.db`. **Anonymous upload is opt-in.**

| Install path | Default sharing |
|--------------|-----------------|
| `traceback-setup` | **OFF** |
| `traceback-setup --plugin` | **ON** (with disclosure) |

Never uploaded: queries, paths, commits, transcripts, PII. Details: [`docs/TELEMETRY.md`](docs/TELEMETRY.md).

Dashboard: `traceback-dashboard` → `http://127.0.0.1:5555`

## Documentation

| Doc | Contents |
|-----|----------|
| [`SETUP.md`](SETUP.md) | Install, hooks, indexing/backfill, per-IDE warm-start, flags, doctor |
| [`docs/API.md`](docs/API.md) | All MCP tools (28 registered) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Funnel layers, storage, widening vs HITL |
| [`docs/TELEMETRY.md`](docs/TELEMETRY.md) | Schema, KPIs, opt-in/out, upload |
| [`SKILL.md`](SKILL.md) | Host-first routing for agents |
| [`docs/DEV.md`](docs/DEV.md) | Tests, security gates, bench SLAs |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute (clone → PR) |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Community standards |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting |
| [`SUPPORT.md`](SUPPORT.md) | Where to ask for help |
| [`CLAUDE.md`](CLAUDE.md) | Contributor stack, conventions, testing |
| [`AGENTS.md`](AGENTS.md) | Short pointer for coding agents |
| [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) | **Doc layering policy** (where to put new content) |
| [`actual_codebase_measures/`](actual_codebase_measures/) | Real-repo warm-start measurements vs blind grep |

## Limitations

- **L1 needs indexed sessions** — L2/L3 still run without them (git-only cold start).
- **One repo at a time** — no cross-repo recall yet.
- **General-purpose embeddings** — `all-MiniLM-L6-v2`; domain-specific models deferred.
- **Session adapters** — Claude Code, Cursor, Copilot today; Windsurf/JetBrains hooks only.

## Development

```sh
npm run build && npm test
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/DEV.md`](docs/DEV.md). Coding agents: [`CLAUDE.md`](CLAUDE.md) and [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

## Contributing

Feedback, bug reports, and PRs welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security reports: [`SECURITY.md`](SECURITY.md). Help: [`SUPPORT.md`](SUPPORT.md).

---

MIT licensed. [`LICENSE`](LICENSE) · https://github.com/yavdaanalytics/traceback
