# traceback Setup & Quick Start

> Install and host-specific detail live here — not in `README.md`. Doc policy: [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

## Rollout status

| Phase | Status | Commands |
|-------|--------|----------|
| **1 — Local observability** | Implemented | `traceback-dashboard`, `get_efficiency_report`, `traceback-telemetry export --local` |
| **2 — Opt-in anonymous upload** | Implemented | `traceback-telemetry enable`, `preview`, `upload` |
| **3 — Public transparency** | Implemented | `traceback-metrics` (self-hosted collector) |
| **4 — Enterprise mode** | Roadmap | Signed reports, org controls, compliance retention (not in OSS scope) |

Details: [`docs/TELEMETRY.md`](docs/TELEMETRY.md). Plain `traceback-setup` prompts at the end (default **OFF**, `[y/N]`). Plugin installs use `traceback-setup --plugin` (default **ON**, `[Y/n]`) with install-time disclosure.

## 1. Initial Setup

**Recommended — one global install for all repositories:**

```sh
npm install -g traceback   # optional
traceback-setup            # or: npx traceback-setup
```

When prompted `Enable traceback for ALL repositories on this machine? [Y/n]`, accept the default **Yes** to configure:

- **Portable global MCP** — `npx -y traceback` in `~/.cursor/mcp.json` and `~/.claude/.mcp.json` (create-if-missing)
- **Global git hooks** — `~/.traceback/hooks` via `core.hooksPath` (post-commit indexing on every repo; see [§6 — global hook, per-repo scope](#global-post-commit-hook-per-repo-scope))
- **Global Cursor hooks** — `~/.cursor/hooks.json` (repo resolved from `workspace_roots` / `cwd`)
- **Claude Code hooks** — `~/.claude/settings.json` warm-start MCP hooks
- **Global git excludes** — `core.excludesFile` patterns for `/data/traceback.db`, `/data/lancedb/`, `/.traceback/` (no `.gitignore` pollution)
- **Skills** — `SKILL.md` synced to `~/.cursor/skills/traceback` and `~/.claude/skills/traceback`

Non-interactive: `TRACEBACK_SETUP_ALL_REPOS=true traceback-setup` or `--yes-all-repos` / `--no-all-repos`.

Verify: `traceback-setup --doctor`

**Per-repo only** (when you declined global setup or need project-level host files):

```sh
cd your-repo
npx traceback-setup --repo-only
```

This installs:
- **Git post-commit hook** (skipped when global `core.hooksPath` is already set)
- **MCP server registration** — merges into project `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` when present
- **Per-IDE warm-start hooks** — project `.cursor/hooks.json`, `.github/hooks/`, `.windsurf/` when those configs exist
- **Local excludes** — `.git/info/exclude` by default (or `--use-gitignore` / `--exclude-mode=gitignore`)
- **CLAUDE.md onboarding** — creates or updates a marked `## Traceback debugging` section (idempotent; skip with `--skip-claude-md`)

Refresh onboarding only: `traceback-setup --claude-md-only`

Verify repo onboarding: `traceback-setup --doctor` (from inside the git repo)

If another tool owns `core.hooksPath` (e.g. Husky), re-run with `--chain-hooks` to chain the existing post-commit hook.

Dev mode (absolute `dist/` paths): `TRACEBACK_DEV=1 traceback-setup`

### Warm-start by IDE

| IDE | Config written by setup | Behavior |
|-----|-------------------------|----------|
| Claude Code | `~/.claude/settings.json` | Native MCP hooks on every prompt and before file reads |
| VS Code / Copilot / JetBrains Copilot | `.github/hooks/traceback-warmstart.json` | Injects `search_with_fallback` context on prompt submit and before Read |
| Cursor | `~/.cursor/hooks.json` (global) or `.cursor/hooks.json` + `.cursor/rules/traceback.mdc` (per-repo) | `beforeReadFile` injects scoped context; `preToolUse` blocks `Grep`/`Glob` until `search_with_fallback` runs; rule mandates MCP as first tool call |
| Windsurf | `.windsurf/hooks.json` + `.windsurf/mcp.json` | `pre_user_prompt` hook runs warm-start before each prompt |

Manual warm-start CLI: `npx traceback-warmstart --format plain --query "your question" --repo-path .`

## Host-first routing (skill gate before MCP)

For hosts that support skill-style routing (for example Claude/Cursor workflows),
use a **balanced host-first** gate:

- strong keyword/semantic match -> call `search_with_fallback`
- weak/ambiguous match -> still call `search_with_fallback` (fallback)
- clear non-code prompt -> skip traceback

Reference metadata schema: [`SKILL.md`](SKILL.md).

### Plugin install path

The Cursor and Claude plugin packages under `plugins/` are synced from setup (`npm run release:sync-plugins` after `npm run build`) and bundle:

- `plugins/cursor-traceback/` — skill, rules, portable warm-start `hooks/hooks.json`, `mcp.json`
- `plugins/claude-traceback/` — skill, portable Claude MCP `hooks/hooks.json`, `mcp.json`

Hooks and MCP entries match `portableCursorHooksConfig` / `portableClaudeHooksConfig` / `portablePluginMcpConfig` in `src/cli/setup.ts`. `traceback-setup --plugin` still configures global git hooks, host MCP merges, and telemetry disclosure.

After enabling the plugin in your IDE, run **per repo**:

```sh
npx traceback-setup --plugin
```

Setup prints what is collected, states that sharing defaults **on** for plugin installs, and how to opt out (`n` at the prompt, or `traceback-telemetry disable` later). Non-interactive `--plugin` runs auto-enable sharing.

Use plain `npx traceback-setup` if you prefer default-off sharing (`[y/N]`).

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

### Telemetry CLI (Phases 1–2)

```sh
traceback-telemetry status
traceback-telemetry export --local
traceback-telemetry enable
traceback-telemetry preview
traceback-telemetry upload
```

Set `TRACEBACK_TELEMETRY_ENDPOINT` to your collector URL before uploading.

### Public metrics collector (Phase 3)

```sh
traceback-metrics
```

Serves `POST /v1/rollups`, `GET /api/public/stats`, and a public HTML page at `/`.

Production: **`https://traceback.yavda.com`**. Self-host guide: [`deploy/README.md`](deploy/README.md).

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
       └─► Data layer (auto-indexed by global post-commit hook — per-repo `data/`)
            ├─► LanceDB (data/lancedb/) — turn + commit embeddings
            └─► SQLite (data/traceback.db) — sessions, commits, telemetry
```

Implementation: `src/mcp/fallback.ts` (`searchWithFallback`). Individual MCP tools map to each layer for manual/agent-driven stepping.

## 6. Data Storage

Session data and telemetry live in:
- **`data/traceback.db`** — SQLite database (sessions, commits, tool invocations, feedback)
- **`data/lancedb/`** — LanceDB vector store (session embeddings)

Both are auto-created on first session ingestion.

### Global post-commit hook (per-repo scope)

traceback uses a **single global** git hook — not one hook per repository:

| Aspect | Behavior |
|--------|----------|
| **Installation** | `~/.traceback/hooks/post-commit` + `git config --global core.hooksPath` |
| **Trigger** | Every `git commit` in any repository on the machine |
| **Repo detection** | Hook runs `git rev-parse --show-toplevel` and passes that path to `traceback-hook-entry` |
| **Ingest filter** | Only IDE sessions whose workspace path matches the committing repo |
| **Storage** | `<repo>/data/traceback.db` and `<repo>/data/lancedb/` — not shared across repos |

```
git commit (any repo)
  → global post-commit hook (~/.traceback/hooks)
  → REPO_ROOT = git rev-parse --show-toplevel
  → scan ~/.claude/projects, ~/.cursor/projects, ~/.copilot/..., AppData vscdb, etc.
  → keep sessions where project path == REPO_ROOT
  → write embeddings + SQLite under REPO_ROOT/data/
```

There is **no bulk scan on install** — indexing is lazy. The first commit in a repo after setup effectively backfills that repo's matching sessions from IDE storage. The hook also links the most recently active session (within 15 minutes) to the new commit SHA.

**Non-blocking ingest:** set user-level `TRACEBACK_HOOK_BACKGROUND=1`, then re-run `traceback-install-global-hook` so large first-time ingests run detached and do not block `git commit`. MCP `env` in `mcp.json` does **not** apply to git hooks — use OS user environment variables.

**Manual backfill:** `traceback-ingest --repo <path>` uses the same per-repo filter without waiting for a commit (see below).

### IDE session storage (what gets indexed)

Indexing is **per git repo** (`data/` under the repo root). Adapters read these transcript locations (Windows paths shown; macOS/Linux use `~` equivalents):

| Adapter | Storage path | Format |
|---------|--------------|--------|
| **claude-code** | `%USERPROFILE%\.claude\projects\<encoded-project>\` | `*.jsonl` session transcripts |
| **cursor** (legacy) | `%APPDATA%\Cursor\User\workspaceStorage\<hash>\state.vscdb` | Composer chat in SQLite |
| **cursor** (agent) | `%USERPROFILE%\.cursor\projects\<encoded-path>\agent-transcripts\` | `<session-id>.jsonl` |
| **copilot** (VS Code) | `%APPDATA%\Code\User\workspaceStorage\<hash>\chatSessions\` | `*.json` chat sessions |
| **copilot** (agent) | `%USERPROFILE%\.copilot\session-state\<uuid>\` | `events.jsonl` + `workspace.yaml` |

Folder names under `.claude/projects` and `.cursor/projects` encode the project path (e.g. `c--source-traceback` → `c:\source\traceback`).

### Storage path overrides (env)

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRACEBACK_CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude JSONL root |
| `TRACEBACK_CURSOR_STORAGE` | `%APPDATA%/Cursor/User` | Legacy composer vscdb |
| `TRACEBACK_CURSOR_PROJECTS_DIR` | `~/.cursor/projects` | Agent transcript JSONL |
| `TRACEBACK_COPILOT_STORAGE` | `%APPDATA%/Code/User` | VS Code chatSessions |
| `TRACEBACK_COPILOT_SESSION_STATE_DIR` | `~/.copilot/session-state` | Copilot agent events |
| `TRACEBACK_HOOK_BACKGROUND` | unset (sync) | Set to `1` to detach post-commit ingest |

MCP `env` in `mcp.json` applies to the MCP server only. Git hooks read **user-level** environment variables.

### Backfill (without blocking git or MCP)

Use **`traceback-ingest`** for scoped, out-of-band indexing:

```sh
npm run build
traceback-ingest --repo c:/source/your-repo
traceback-ingest --repo c:/source/your-repo --adapter-id claude-code
traceback-ingest --repo c:/source/your-repo --adapter-id cursor
traceback-ingest --repo c:/source/your-repo --adapter-id copilot --json
```

Always pass `--repo` (or run from inside the git repo). Ingest is filtered to sessions whose workspace path matches that repo.

On Windows, set `TRACEBACK_HOOK_BACKGROUND=1` in user environment variables before re-running `traceback-install-global-hook` so large first-time ingests do not block `git commit`.

First ingest may take up to ~90s while `fastembed` downloads the embedding model.

## 7. Phase 1 verification (real ~/.claude history)

After `npm run build` and `npx traceback-setup`:

1. Install global hook once: `traceback-install-global-hook`
2. Backfill existing sessions: `traceback-ingest --repo c:/source/your-repo` (or make a commit while an IDE session is active)
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
- After a successful run, check `<repo>/data/traceback.db` exists and `.git/traceback-hook.log` for errors.

**Hook runs but no sessions indexed?**
- Ingest is scoped to the committing repo — sessions must have a workspace path matching that repo (Claude/Cursor encoded project dirs, Copilot `workspace.yaml` `git_root`/`cwd`).
- Backfill existing history without a commit: `traceback-ingest --repo c:/path/to/your-repo`.
- First ingest can take ~90s while `fastembed` downloads the embedding model.

**Want to opt out of anonymous telemetry?**
- During setup: answer `n` at the sharing prompt.
- Anytime: `traceback-telemetry disable`
- Keep opt-in but stop daily uploads: `traceback-telemetry auto-upload off`
- Check status: `traceback-telemetry status`

See `CLAUDE.md` for developer details on testing, security invariants, and architecture.
