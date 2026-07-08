# traceback Setup & Quick Start

## 1. Initial Setup

```sh
cd your-repo
npx traceback-setup
```

This installs:
- **Git post-commit hook** — automatically catalogs sessions at each commit
- **MCP server registration** — wires traceback into Claude Code, VS Code, Cursor, and Windsurf (for whichever IDEs have config files present in your repo)
- **Per-IDE warm-start hooks** — automatic context scoping where each host's hook API allows it (see below)

### Warm-start by IDE

| IDE | Config written by setup | Behavior |
|-----|-------------------------|----------|
| Claude Code | `~/.claude/settings.json` | Native MCP hooks on every prompt and before file reads |
| VS Code / Copilot / JetBrains Copilot | `.github/hooks/traceback-warmstart.json` | Injects `search_with_fallback` context on prompt submit and before Read |
| Cursor | `.cursor/hooks.json` + `.cursor/rules/traceback.mdc` | `beforeReadFile` injects scoped context; `preToolUse` blocks `Grep`/`Glob` until `search_with_fallback` runs; rule mandates MCP as first tool call |
| Windsurf | `.windsurf/hooks.json` + `.windsurf/mcp.json` | `pre_user_prompt` hook runs warm-start before each prompt |

Manual warm-start CLI: `npx traceback-warmstart --format plain --query "your question" --repo-path .`

## Host-first routing (skill gate before MCP)

For hosts that support skill-style routing (for example Claude/Cursor workflows),
use a **balanced host-first** gate:

- strong keyword/semantic match -> call `search_with_fallback`
- weak/ambiguous match -> still call `search_with_fallback` (fallback)
- clear non-code prompt -> skip traceback

Reference metadata schema: [`SKILL.md`](SKILL.md).

## 2. Using traceback in Your IDE

Once set up, traceback is available as an MCP server in:
- **Claude Code** — through `.mcp.json`
- **VS Code / GitHub Copilot** — through `.vscode/mcp.json`
- **Cursor** — through `.cursor/mcp.json` and/or `~/.cursor/mcp.json` (global)
- **Windsurf** — through `.windsurf/mcp.json` (when present)

### MCP server routing (`call_server_id`)

Hosts use **two different names** for traceback:

| Context | Name | Example |
|---------|------|---------|
| `mcp.json` config key | always `traceback` | `"mcpServers": { "traceback": { ... } }` |
| Cursor `CallMcpTool` / tool routing id | config key, or `user-` + key for **global** Cursor installs | `user-traceback` |
| Claude Code native `mcp_tool` hooks | config key | `server: "traceback"` |

`npx traceback-setup` writes:

- `~/.traceback/install.json` — per-host `call_server_id` records
- `TRACEBACK_MCP_SERVER_ID` in each MCP server `env` block
- `.cursor/rules/traceback.mdc` — always-on rule with the resolved Cursor `call_server_id`

If an agent call fails with “server does not exist”, call **`get_connection_info`** first (on any listed traceback server) or check the `mcps/` tool descriptors for the folder containing `search_with_fallback`.

For deferred-schema hosts (for example Claude Code), call **`get_traceback_status`** first to get discovery hints, then apply host-first gate behavior before falling back to generic grep/glob.

### Primary tool: `search_with_fallback`

Call this first for warm-start. It runs the 4-layer funnel in one response:

| Layer | What it does | Always runs? |
|-------|----------------|--------------|
| **L1** | `find_similar_sessions` — LanceDB cosine recall over past sessions | Attempted; may be empty |
| **L2** | `git_history_scope` — `git log -S` pickaxe + commit intent embeddings | **Yes** |
| **L3** | `search_sessions_grep` — scoped grep, widens to git files then full repo | **Yes** |
| **L4** | `ast_symbol_search`, `diff_search`, `keyword_search` refinements | Keyword always |

Response fields: `mode`, `session_matches`, `git_scope`, `grep_result`, `refinements`, `layers`.

### Other MCP tools (granular / follow-up)

- `get_connection_info` — resolve `call_server_id` for CallMcpTool routing
- `find_similar_sessions` / `search_dev_history` — L1 only (with optional filters)
- `git_history_scope` — L2 only
- `search_sessions_grep` / `grep_codebase` — L3 grep
- `ast_search` / `ast_symbol_search` / `diff_search` / `keyword_search` — L4-style precision
- `blame_current` — map a historical match to HEAD
- `get_session_detail` / `get_session_lineage` / `get_change_graph` / `get_commit_context` — graph walks
- `ingest_session` / `list_adapters` — indexing introspection
- `get_efficiency_report` — telemetry
- `submit_feedback` — down-weight wrong session matches
- `link_session_commit` / `tag_outcome` — manual graph corrections

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
npm test           # full test suite (unit/integration/e2e/regression/evals/security/contracts)
npm run bench      # optional: latency/throughput at scale
```

## 5. Architecture at a Glance

```
IDE (Claude Code, Cursor, VS Code, Windsurf)
  │
  ├─► Warm-start hooks (per IDE — see table in §1)
  │    └─► traceback-warmstart CLI or native mcp_tool hooks
  │         └─► search_with_fallback (4-layer funnel)
  │
  └─► MCP server (dist/mcp/index.js)
       │
       ├─► L1 find_similar_sessions     (LanceDB session vectors)
       ├─► L2 git_history_scope         (git pickaxe + commit intent)  ← always
       ├─► L3 search_sessions_grep      (scoped → widened grep)        ← always
       ├─► L4 ast / diff / keyword      (refinements)
       │
       └─► Data layer (auto-indexed by global post-commit hook)
            ├─► LanceDB (data/lancedb/) — turn + commit embeddings
            └─► SQLite (data/traceback.db) — sessions, commits, telemetry
```

Implementation: `src/mcp/fallback.ts` (`searchWithFallback`). Individual MCP tools map to each layer for manual/agent-driven stepping.

## 6. Data Storage

Session data and telemetry live in:
- **`data/traceback.db`** — SQLite database (sessions, commits, tool invocations, feedback)
- **`data/lancedb/`** — LanceDB vector store (session embeddings)

Both are auto-created on first session ingestion.

## 7. Phase 1 verification (real ~/.claude history)

After `npm run build` and `npx traceback-setup`:

1. Install global hook once: `traceback-install-global-hook`
2. Make at least one commit in the repo while a Claude Code session is active (or re-ingest via MCP `ingest_session`)
3. Run the opt-in E2E script:

```sh
TRACEBACK_E2E=1 node scripts/phase1-e2e.mjs --repo c:/source/traceback --query "your known topic"
```

Or verify manually via MCP:
- `ingest_session` with `project_path` set to your repo path
- `search_dev_history` with a query you know matches past work
- Confirm the response includes `confidence`, `outcome`, `outcome_evidence`, and `linkedCommits[].sha`

### Automated prompt-capture tests (CI-safe)

Runs a synthetic golden prompt through Claude fixture JSONL, git commit, hook linkage, ingest, recall, warm-start hooks, and MCP stdio — no live IDE required:

```sh
npm run test:prompt-capture
```

Covers:
- `tests/e2e/prompt-capture.test.ts` — hook → ingest → `search_dev_history`
- `tests/e2e/prompt-capture-mcp.test.ts` — MCP `ingest_session` / `search_dev_history` / `search_with_fallback`
- `tests/integration/warm-start-prompt.test.ts` — VS Code / Cursor / Windsurf hook stdin → real `searchWithFallback`
- `tests/unit/prompt-capture-fixture.test.ts` — fixture path encoding + adapter discovery

## 8. Troubleshooting

**Dashboard shows no data?**
- Make sure at least one session has been captured (commit something after setup).
- Verify `data/traceback.db` exists in your repo root.

**MCP server not showing up in IDE?**
- Run `traceback-setup` again to regenerate the config file.
- Check the IDE's settings to ensure MCP is enabled and config file path is correct.

**Warm-start hooks not firing?**
- **Claude Code**: check `~/.claude/settings.json` hooks and the Hooks output in Claude Code settings.
- **VS Code / Copilot**: open Output panel → **GitHub Copilot Chat Hooks** channel; verify `.github/hooks/traceback-warmstart.json` exists.
- **Cursor**: open **Hooks** tab in Cursor settings or the Hooks output channel; verify `.cursor/hooks.json` and `.cursor/rules/traceback.mdc`.
- **Windsurf**: verify `.windsurf/hooks.json` contains `pre_user_prompt`.
- First warm-start can take up to ~90s while embeddings download; hook timeout is set to 90 seconds.

**Git hook not triggering?**
- Verify `~/.traceback/hooks/post-commit` exists (or check `git config --global core.hooksPath`).
- Try a manual commit: `git commit --allow-empty -m "test hook"`.

See `CLAUDE.md` for developer details on testing, security invariants, and architecture.
