# traceback

Semantic debugger MCP server: helps LLM agents find the right code *fast* by warming up grep with embedding-based context recall, turning a blind O(repo) search into a scoped O(session) search.

## Telemetry Rollout (Phases 1–3)

Open, privacy-first telemetry for proving warm-start effectiveness. **Plain `traceback-setup` keeps sharing OFF by default.** **Plugin installs** (`traceback-setup --plugin`) default sharing **ON** with install-time disclosure and opt-out instructions.

| Phase | Status | Summary |
|-------|--------|---------|
| **1 — Local observability** | Implemented | `data/traceback.db`, `traceback-dashboard`, `get_efficiency_report`, `traceback-telemetry export` |
| **2 — Opt-in anonymous aggregates** | Implemented | `install_id` + daily rollups; opt-in enables daily auto-upload (`upload-due` / MCP startup) or manual `upload` |
| **3 — Public transparency** | Implemented | Self-hosted `traceback-metrics` + `https://traceback.yavda.com` |
| **4 — Enterprise mode** | Roadmap | Signed reports, org controls, compliance retention (not in OSS scope) |

Collector API auth remains deferred. Full schema, KPIs, redaction, and cron setup: [`docs/TELEMETRY.md`](docs/TELEMETRY.md).

## The Problem

When an agent hits a bug or question — "why is this authentication failing?" — the only tools it has are `grep` and `git blame`. Both suffer the same fatal flaw: they're scope-blind. A naive `git grep "token"` across a 100K-line repo returns hundreds of hits, 95% noise. The agent either drowns in context or makes a lucky guess.

traceback solves this by asking: *"has the agent worked on this kind of problem before?"* If yes, that past session becomes a **scope anchor** — the files touched, commits made, even the conversation intent. Now grep runs against a pre-scoped window. Instead of 45,200 candidate lines, you search 180 lines. That's a 250x reduction in noise, all deterministic, all local, all free.

## Architecture: The Warm-Start Funnel

traceback doesn't replace grep — it **sequences** fuzzy recall before precise search. The canonical implementation is the **`search_with_fallback`** MCP tool (`src/mcp/fallback.ts`): a 4-layer funnel that always reaches git and grep even when LanceDB session recall is empty.

```
┌─────────────────────────────────────────────────────────────────┐
│ Query: "jwt token expiry causing 401 errors"                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │ L1 SESSION RECALL    │  find_similar_sessions
              │ LanceDB cosine ANN   │  (optional — can return 0 hits)
              └──────────┬──────────┘
                         │ high-confidence hit → files from session→commit links (SQLite)
              ┌──────────▼──────────┐
              │ L2 GIT HISTORY       │  git_history_scope — ALWAYS runs
              │ pickaxe + intent     │  git log -S, commit-message embeddings
              └──────────┬──────────┘
                         │ if scope still empty → files from matching commits
              ┌──────────▼──────────┐
              │ L3 GREP            │  search_sessions_grep — ALWAYS runs
              │ scoped → widen       │  scoped files → git files → full repo
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │ L4 REFINEMENTS     │  ast_symbol_search, diff_search, keyword_search
              └──────────┬──────────┘
                         │
              ┌──────────▼─────────────────────────────┐
              │ Result: sessions + commits + grep hits │
              │ + refinements returned in one payload  │
              └────────────────────────────────────────┘
```

**Each layer feeds the next.** L1 is a bonus scope anchor when past sessions match; L2–L3 still run on a cold start (no indexed sessions). L3 widens automatically if scoped grep returns nothing — the funnel sequences options, it does not hard-filter.

| Layer | MCP tool(s) | Storage / mechanism | Runs when |
|-------|-------------|---------------------|-----------|
| **L1** | `find_similar_sessions` | LanceDB `turn_embeddings` + SQLite penalties | Always attempted; may return `[]` |
| **L2** | `git_history_scope` (internal) | `git log -S` pickaxe + LanceDB commit intent | **Always** |
| **L3** | `search_sessions_grep` (internal) | ripgrep/git grep, scoped then widened | **Always** (at least full-repo) |
| **L4** | `ast_symbol_search`, `diff_search`, `keyword_search` | AST-grep, git diff, keyword scan | Keyword always; ast/diff when scope/git hits exist |

Agents can call **`search_with_fallback`** once (recommended for warm-start) or invoke individual tools in the order above. See `PROMPT.md` for the manual multi-tool pipeline (`ast_search` → `search_sessions_grep` → `blame_current`) used when stepping through layers explicitly.

### L1: Semantic session recall

When you work on a bug, you're working *in a session* — a coding-agent session stored as a transcript. traceback indexes these sessions via embeddings (locally, using `fastembed` / `all-MiniLM-L6-v2`), stores them in LanceDB, and uses **cosine-similarity ANN search** to find the most contextually-relevant past session for a new query.

Why embeddings?
- **Fuzzy matching**: "jwt timeout" and "token expiry" are semantically the same; a regex won't catch both.
- **No manual tagging**: the embedding model learns from the raw session text — no need for humans to tag bugs as "auth", "performance", etc.
- **Local & free**: `fastembed` runs entirely offline; zero API calls, zero inference cost, purely CPU-bound.

If L1 finds a **high-confidence** session (`_distance` ≤ `TRACEBACK_CONFIDENCE_THRESHOLD`, default `0.35`), files touched by that session's linked commits become the initial grep scope. If L1 is empty or low-confidence, L2 supplies scope from git history instead.

### L2: Git history scope

**Always runs**, independent of L1. `git_history_scope` uses `git log -S` (pickaxe) on terms derived from the query, optionally enriched by commit-message intent embeddings in LanceDB. Matching commits and their `files_changed` narrow the search window when L1 did not.

Why git-based scope?
- **Authoritative**: git history is the source of truth for when code changed.
- **Cheap**: no custom graph traversal — `git log` answers "which commits touched this term?"
- **Cold-start friendly**: works even with zero indexed sessions (e.g. first day on a repo).

### L3: Scoped grep with automatic widening

`search_sessions_grep` runs against the scoped file set from L1 and/or L2. If that returns no hits, the funnel widens to all files touched by L2 commits, then to a **full-repo grep** if still empty. The response `mode` field records which path was taken (`scoped_session`, `cold_start_git_scoped`, `grep_full_repo`, etc.).

### L4: Refinements

After grep, the funnel adds structural and diff context: `ast_symbol_search` on scoped files (when a symbol term is derivable), `diff_search` against the top git-scoped commit, and `keyword_search` (always). These land in the `refinements` field of the `search_with_fallback` response.

## Why This Matters

### Speed
- Blind `git grep "token"` on a 100K-line repo: 500–1000ms.
- Warm-start funnel (semantic + scope + grep on 180 lines): ~30ms total.
- **33x faster**. On a 10x bigger repo, it's 330x faster.

### Recall
- Agents using blind grep often accept the first plausible match, even if it's wrong (the needle-in-haystack trap).
- Warm-start grep returns so few results that the agent can reason about all of them.

### Token efficiency
- An agent's context window is its most expensive resource.
- Returning 180 relevant lines instead of 45,000 noisy lines means the agent can afford to read *all* the matches, reason about them, and ask follow-ups without burning context.

## Data Flow & Storage

```
┌──────────────────────┐
│ Session transcript   │  (e.g., from Claude Code, Cursor)
│ (raw JSON/JSONL)     │
└──────┬───────────────┘
       │ ingest_session
       │
    ┌──▼──────────────────────┐
    │ Session embeddings      │  (turn summaries, tool calls)
    │ stored in LanceDB       │  vector ANN search: "find similar"
    └──┬──────────────────────┘
       │
    ┌──▼──────────────────────┐
    │ SQLite relational graph │
    │ - sessions              │  fast lookup: "which files were touched?"
    │ - commits               │  cross-referencing: "which session owns this commit?"
    │ - session_commit_links   │  audit trail: "when was this linked?"
    │ - files_touched         │
    └─────────────────────────┘
```

**Why two databases?**
- **LanceDB** (vector store): optimized for ANN ("find embeddings similar to X"). But ANN doesn't give you SQL joins — you can't ask "find the session AND get all its linked commits AND all files those commits touched."
- **SQLite** (relational): persists the graph (sessions, commits, file relationships) and handles the multi-hop queries. Also lightweight, batteries-included, no separate service.

Together they're **fast and queryable**. Separately, each is incomplete.

## Observability & Human-in-the-Loop

traceback logs telemetry on every tool invocation — how deep in history a match reached, how many lines were scoped vs. an unscoped grep baseline, whether the match was a hit or miss. Over time, this answers: *"is the warm-start funnel actually saving tokens, or just moving the problem around?"*

For hosts that support pre-routing before MCP calls, traceback also supports a
balanced host-first contract via [`SKILL.md`](SKILL.md): strong and weak matches
invoke traceback, while clearly non-code prompts skip it.

### Real-Time Dashboard

Run **`traceback-dashboard`** to launch an interactive web dashboard at `http://127.0.0.1:5555`:

```sh
cd your-repo
traceback-dashboard
```

The dashboard displays:
- **Invocation activity** — tool calls over time (line chart)
- **Session indexing volume** — sessions added per day (bar chart)
- **Per-tool metrics** — invocation count, average latency, average line-reduction % for each tool
- **Summary KPIs** — total invocations, indexed sessions, overall line reduction, average latency

Dashboard data comes live from your repo's `data/traceback.db` and updates every 5 seconds. Environment variable `TRACEBACK_DASHBOARD_PORT` overrides the default port.

### Manual Telemetry Queries

For programmatic access, call `get_efficiency_report` from the MCP server — returns JSON with call counts, average latency, line-reduction %, average git-history depth.

### Human-in-the-Loop Feedback

When the agent gets a match wrong (semantic recall pointed at the wrong session), it can submit feedback: `submit_feedback(session_id, verdict="reject")`. traceback then **down-weights that session's future ranking** — not deleting it, just making it less likely to surface next time. This is a lightweight form of HITL loop: the system learns from human corrections without requiring retraining.

## All Local, All Free

- **No API calls**: embeddings run offline via `fastembed`.
- **No external services**: LanceDB is embedded, SQLite is embedded, git is already on the machine.
- **No models to download**: `all-MiniLM-L6-v2` (22M parameters) downloads once on first use (~40MB).
- **Single binary**: the MCP server is Node + TypeScript, cross-platform (Claude Code, Cursor, VS Code/Copilot, Windsurf, JetBrains).
- **Zero-setup installation**: global git hooks plus per-IDE warm-start hooks via `npx traceback-setup` (see table below).

## Limitations & Trade-offs

**Scope-narrowing assumes prior work for L1**: if you've never worked on JWT issues before, L1 session recall may be empty — but **L2 git pickaxe and L3 grep still run** (`cold_start_git_scoped` or `grep_full_repo`). Warm-start is strongest when past sessions are indexed; git-only cold start is the built-in fallback.

**Embedding model quality**: `all-MiniLM-L6-v2` is general-purpose; it may miss domain-specific nuances. A finance codebase might benefit from a model trained on financial data. Swappable, but not done in v1.

**No cross-repo scope**: traceback indexes one repo at a time (matching its per-repo install model). Multi-repo queries would need cross-repo session indexing — deferred.

**Manual override required**: if traceback makes a wrong call, the agent must explicitly widen scope or call a different tool. No automatic fallback (by design — keeps the agent in control).

## Quick Install

### Automatic (Recommended)
```sh
npm install
```
Done. The setup script automatically:
- Sets up global git hooks at `~/.traceback/hooks` (runs on every commit across all repos)
- Registers the MCP server in your editor's config (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.windsurf/mcp.json`)
- Configures **per-IDE warm-start hooks** when the matching config file exists in the repo:

| IDE | Warm-start mechanism |
|-----|---------------------|
| **Claude Code** | Native `mcp_tool` hooks on `UserPromptSubmit` + `PreToolUse` Read (`~/.claude/settings.json`) |
| **VS Code / Copilot / JetBrains Copilot** | Command hooks on `UserPromptSubmit` + `PreToolUse` Read (`.github/hooks/traceback-warmstart.json`) |
| **Cursor** | Hybrid: `beforeReadFile` hook + `preToolUse` Grep/Glob gate + always-on rule (`.cursor/rules/traceback.mdc`) — agent must call `search_with_fallback` before repo search |
| **Windsurf** | `pre_user_prompt` command hook (`.windsurf/hooks.json`) when `.windsurf/` is present |

Cursor cannot inject per-prompt context via `beforeSubmitPrompt` (block-only). Enforcement uses the always-on rule plus a `preToolUse` hook that denies `Grep`/`Glob` until `search_with_fallback` runs (`afterMCPExecution` marks the turn).

### Plugin install

After installing the Claude or Cursor plugin package, run per repo:

```sh
npx traceback-setup --plugin
```

Plugin setup defaults anonymous sharing **ON** (`[Y/n]`) with full disclosure. Plain `traceback-setup` defaults **OFF** (`[y/N]`).

### Manual Trigger
If you need to re-run setup:
```sh
npx traceback-setup
```

The installation is **idempotent** — safe to run multiple times. It detects existing configurations and skips redundant work.

For troubleshooting or manual setup, see [`SETUP.md`](SETUP.md).

## Development & Observability

```sh
npm run build                 # compile TypeScript → dist/
npm test                      # full test suite (unit, integration, e2e, regression, evals, security, contracts)
npm run bench                 # performance benchmarks at 1k/5k/10k-row scale with SLA gates
npm run security:sast         # static analysis (requires `pip install semgrep`)
npm run security:audit        # dependency audit
traceback-dashboard           # launch web dashboard at http://127.0.0.1:5555
traceback-telemetry status    # local/opt-in telemetry config
traceback-metrics             # self-hosted public metrics collector (Phase 3)
```

### Security & Quality Gates

traceback enforces three critical P0 security and performance gates:

1. **Prompt Injection Defense** (22 tests): validates that malicious LLM-generated inputs (SQL injection, git option injection, shell metacharacters, file path traversal) cannot break tool execution or expose unintended data. Core defense: `execFileSync` argv array isolation (command inputs passed as separate array elements, never interpolated into shell strings).

2. **Tool Schema Contracts**: ensures all MCP tool signatures maintain backwards-compatibility (21 tools registered). Tests validate required fields, enum constraints, and type constraints.

3. **Latency SLA Budgets** (CI-gated in `npm run bench`): performance benchmarks fail CI if latencies exceed thresholds, catching 2-3x regressions automatically:
   - `sqlite-insert`: p95 ≤ 20ms, p99 ≤ 50ms
   - `sqlite-query` (10k rows): p95 ≤ 200ms, p99 ≤ 250ms
   - `lancedb-search`: p95 ≤ 100-150ms (scale-dependent)

See `CLAUDE.md` for testing architecture, regression pinning, and the hard security rule (command-injection prevention via `execFileSync` argv arrays, not string interpolation).

## Design Philosophy

**Prefer recall over precision, with human override.**
- Better to surface a potentially-wrong session than miss the right one (the agent can reject it).
- The agent is in control — traceback proposes, the agent decides.

**Keep it local and offline.**
- No cloud dependency, no API costs, no latency variance, no account required.
- Privacy: session data stays on your machine.

**Minimize custom infrastructure.**
- Use proven platforms: git (for history), SQLite (for relational data), LanceDB (for embeddings).
- Avoid hand-rolled graph traversal, custom serialization, or re-implementing what git already does.

**Semantics + precision, not either-or.**
- Embeddings are fast but fuzzy (high recall, lower precision).
- Grep is slow but exact (lower recall, high precision).
- Together: fast + exact.


## Telemetry & Privacy

Local telemetry (Phase 1) is always recorded in `data/traceback.db` on your machine. **Anonymous sharing** (Phase 2) is optional.

| Install path | Default sharing | Prompt |
|--------------|-----------------|--------|
| `traceback-setup` | OFF | `[y/N]` |
| `traceback-setup --plugin` | ON | `[Y/n]` |

**Collected when opted in:** invocation counts, latency, warm-start line/token savings, trigger stats, anonymous `install_id`, hashed `repo_hash`, traceback version.

**Never collected:** queries, paths, commits, transcripts, PII.

```sh
traceback-telemetry status
traceback-telemetry disable          # opt out anytime
traceback-telemetry auto-upload off  # manual uploads only
```

Full schema and redaction policy: [`docs/TELEMETRY.md`](docs/TELEMETRY.md). Plugin installs upload to `https://traceback.yavda.com` when opted in.

## Contributing

This is an early-stage tool. Feedback, bug reports, and PRs are welcome. Key areas where traceback could improve:
- Better embedding models or fine-tuning for code.
- Multi-repo indexing.
- Integration with other session capture systems (not just Claude Code/Cursor).
- Agent eval harness (does this actually help agents find bugs faster?).

---

MIT licensed. See [`LICENSE`](LICENSE). Repository: https://github.com/yavdaanalytics/traceback
