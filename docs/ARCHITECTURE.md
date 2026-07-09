# Architecture

Implementation: `src/mcp/fallback.ts` (`search_with_fallback`), `src/mcp/recall.ts`, `src/git/history-scope.ts`.

> Architecture depth lives here — README has a one-paragraph summary only. Doc policy: [`DOCUMENTATION.md`](DOCUMENTATION.md).

## Warm-start funnel (L1–L4)

traceback **sequences** fuzzy recall before precise search. L2–L3 always run; L1 is a bonus when past sessions are indexed.

```
┌─────────────────────────────────────────────────────────────────┐
│ Query: "jwt token expiry causing 401 errors"                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │ L1 SESSION RECALL    │  find_similar_sessions
              │ LanceDB cosine ANN   │  (optional — can return 0 hits)
              └──────────┬──────────┘
                         │ high-confidence hit → files from session→commit links
              ┌──────────▼──────────┐
              │ L2 GIT HISTORY       │  git_history_scope — ALWAYS runs
              │ pickaxe + intent     │  git log -S, commit-message embeddings
              └──────────┬──────────┘
              ┌──────────▼──────────┐
              │ L3 GREP            │  search_sessions_grep — ALWAYS runs
              │ scoped → widen       │  scoped → git files → full repo
              └──────────┬──────────┘
              ┌──────────▼──────────┐
              │ L4 REFINEMENTS     │  ast_symbol_search, diff_search, keyword_search
              └─────────────────────┘
```

| Layer | MCP tool(s) | Storage / mechanism | Runs when |
|-------|-------------|---------------------|-----------|
| **L1** | `find_similar_sessions` | LanceDB `turn_embeddings` + SQLite penalties | Always attempted; may return `[]` |
| **L2** | `git_history_scope` | `git log -S` pickaxe + LanceDB commit intent | **Always** |
| **L3** | `search_sessions_grep` | git grep, scoped then widened | **Always** (at least full-repo) |
| **L4** | `ast_symbol_search`, `diff_search`, `keyword_search` | AST-grep, git diff, keyword scan | Keyword always; ast/diff when scope/git hits exist |

### L1: Semantic session recall

Sessions are embedded locally (`fastembed` / `all-MiniLM-L6-v2`), stored in LanceDB, and searched with **cosine ANN**.

- Fuzzy matching: "jwt timeout" ≈ "token expiry"
- No manual tagging required
- Offline, no LLM API calls

High-confidence hit: `_distance` ≤ `TRACEBACK_CONFIDENCE_THRESHOLD` (default **0.35**). Linked commit files become initial grep scope. Empty or low-confidence L1 → L2 supplies scope.

### L2: Git history scope

Always runs. `git log -S` (pickaxe) on query-derived terms, enriched by commit-message intent embeddings in LanceDB.

### L3: Scoped grep with automatic widening

Scoped grep on L1/L2 files. If empty: widen to all L2 commit files, then **full-repo grep**. Response `mode` records the path (`scoped_session`, `cold_start_git_scoped`, `grep_full_repo`, etc.).

### L4: Refinements

`ast_symbol_search` (when symbol derivable), `diff_search` (top git-scoped commit), `keyword_search` (always). Returned in `search_with_fallback` refinements / summary fields.

## Data flow & storage

```
┌──────────────────────────┐
│ Session transcript       │  Claude Code, Cursor, or Copilot adapters
│ (JSON/JSONL)             │  (+ optional copy under data/archive/)
└──────────┬───────────────┘
           │ post-commit hook / ingest_session
    ┌──────▼────────────────────────┐
    │ LanceDB (vectors)               │
    │ - turn_embeddings (sessions)    │
    │ - commit_embeddings (messages)  │
    └──────┬──────────────────────────┘
    ┌──────▼──────────────────────────┐
    │ SQLite (relational + telemetry) │
    │ - sessions, commits, links      │
    │ - files_touched, outcomes         │
    │ - tool_invocations              │
    │ - coding_patterns, feedback       │
    └─────────────────────────────────┘
```

**Why two databases?**

- **LanceDB**: ANN similarity search; not suited for multi-hop relational joins.
- **SQLite**: session↔commit graph, telemetry, penalties, promoted patterns.

## Automatic widening vs. human override

`search_with_fallback` widens grep automatically when scoped search returns nothing. When the *wrong session* is recalled, the agent should `submit_feedback(verdict="reject")` or call a different tool — semantic acceptance stays with the agent.

Manual multi-tool pipeline (step through layers): see `SKILL.md` and tool list in [`docs/API.md`](API.md).
