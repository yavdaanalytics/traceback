# traceback Setup & Quick Start

## 1. Initial Setup

```sh
cd your-repo
npx traceback-setup
```

This installs:
- **Git post-commit hook** — automatically catalogs sessions at each commit
- **MCP server registration** — wires traceback into Claude Code, VS Code, and Cursor (for whichever IDEs have config files present in your repo)

## 2. Using traceback in Your IDE

Once set up, traceback is available as an MCP server in:
- **Claude Code** — through `.mcp.json`
- **VS Code with Claude extension** — through `.vscode/mcp.json`
- **Cursor** — through `.cursor/mcp.json`

Tools available:
- `find_similar_sessions` — semantic search over past sessions (warm-start funnel)
- `search_sessions_grep` — grep within narrowed scope
- `ast_search` — structural code search within scope
- `get_session_lineage` — trace commits linked to a session
- `get_efficiency_report` — view telemetry/observability metrics
- `submit_feedback` — down-weight sessions that gave wrong results

## 3. Observability Dashboard

Launch the real-time dashboard while working:

```sh
traceback-dashboard
```

Opens at `http://127.0.0.1:5555` (or set `TRACEBACK_DASHBOARD_PORT=8000` to use a different port).

The dashboard shows:
- **Invocation volume** over time
- **Session indexing** progress
- **Per-tool performance** (latency, line reduction %)
- **Warm-start effectiveness** (scoped lines vs. unscoped baseline)

Data updates live from `data/traceback.db` every 5 seconds.

## 4. Verify Installation

```sh
npm run build      # compile
npm test           # run 61 tests (unit/integration/e2e/regression/evals)
npm run bench      # optional: latency/throughput at scale
```

## 5. Architecture at a Glance

```
IDE (Claude Code, Cursor, VS Code)
  │
  └─► MCP server (dist/mcp/index.js)
       │
       ├─► find_similar_sessions (semantic recall via LanceDB)
       │    └─► search_sessions_grep (scope narrowing via git)
       │         └─► ast_search, git grep (precision search)
       │
       └─► Data layer (auto-indexed by git hook)
            ├─► LanceDB (session embeddings for ANN)
            └─► SQLite (relational graph: commits, files, telemetry)
```

## 6. Data Storage

Session data and telemetry live in:
- **`data/traceback.db`** — SQLite database (sessions, commits, tool invocations, feedback)
- **`data/lancedb/`** — LanceDB vector store (session embeddings)

Both are auto-created on first session ingestion.

## 7. Troubleshooting

**Dashboard shows no data?**
- Make sure at least one session has been captured (commit something after setup).
- Verify `data/traceback.db` exists in your repo root.

**MCP server not showing up in IDE?**
- Run `traceback-setup` again to regenerate the config file.
- Check the IDE's settings to ensure MCP is enabled and config file path is correct.

**Git hook not triggering?**
- Verify `data/.git-hooks/post-commit` exists (or check `git config core.hooksPath`).
- Try a manual commit: `git commit --allow-empty -m "test hook"`.

See `CLAUDE.md` for developer details on testing, security invariants, and architecture.
