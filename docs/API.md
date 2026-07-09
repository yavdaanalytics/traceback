# MCP tools reference

Canonical wiring: `src/mcp/index.ts`. Tool count is checked in `tests/contract/tool-schemas.test.ts`.

> Tool reference lives here — not in README. Doc policy: [`DOCUMENTATION.md`](DOCUMENTATION.md).

**Recommended entry point:** `search_with_fallback` — runs the full L1–L4 warm-start funnel in one call.

## Discovery

| Tool | Purpose |
|------|---------|
| `get_connection_info` | MCP routing: `call_server_id`, config keys, install records from `~/.traceback/install.json` |
| `get_traceback_status` | Indexed session counts and availability hints |

## L1 — Session recall

| Tool | Purpose |
|------|---------|
| `find_similar_sessions` | Cosine search over past session embeddings (`embedding_text` digest) |
| `search_dev_history` | Alias + optional `outcome`, `source_tool`, `tags` filters |

## L2 — Git history scope

| Tool | Purpose |
|------|---------|
| `git_history_scope` | `git log -S` pickaxe + commit-message intent embeddings |

## L3 — Grep

| Tool | Purpose |
|------|---------|
| `search_sessions_grep` | Scoped `git grep` (by files or session-linked commits) |
| `grep_codebase` | Alias for `search_sessions_grep` |

## L4 — Refinements

| Tool | Purpose |
|------|---------|
| `ast_search` | Structural match via ast-grep CLI |
| `ast_symbol_search` | Local symbol definitions/usages (tree-sitter/regex) |
| `diff_search` | Search git history patches |
| `keyword_search` | TODO/FIXME/BUG markers or custom keyword |

## Orchestration

| Tool | Purpose |
|------|---------|
| `search_with_fallback` | 4-layer funnel: session cosine → git → grep → ast/diff/keyword |

## Lineage & drill-down

| Tool | Purpose |
|------|---------|
| `get_session_lineage` | Graph walk (delegates to change graph) |
| `get_change_graph` | Timeline: nearby commits + edge mapping |
| `get_session_detail` | Session row, embedding digest, transcript ref, links |
| `get_commit_context` | Commit → sessions, files, outcome |
| `get_commit_files` | Full `files_changed` for a commit |
| `link_session_commit` | Manual session↔commit correction |
| `blame_current` | Map historical hit to HEAD location |
| `get_match_details` | Code snippet around a grep hit |

## Indexing

| Tool | Purpose |
|------|---------|
| `ingest_session` | Trigger incremental indexer (backfill / troubleshooting) |
| `list_adapters` | Which session adapters are available on this machine |

## Outcomes & HITL

| Tool | Purpose |
|------|---------|
| `tag_outcome` | Manual commit outcome override |
| `submit_feedback` | Confirm/reject a recall result (reject penalizes future ranking) |
| `promote_pattern` | Store reusable coding pattern (**after explicit user confirm**) |
| `list_patterns` | List active promoted patterns for this repo |
| `deprecate_pattern` | Mark a promoted pattern inactive |

## Telemetry

| Tool | Purpose |
|------|---------|
| `get_efficiency_report` | Aggregated tool-call KPIs (text or JSON via `format`) |

## Session adapters

Transcript ingestion adapters (see `src/adapters/`):

| Adapter ID | Host |
|------------|------|
| `claude-code` | Claude Code |
| `cursor` | Cursor |
| `copilot` | VS Code / GitHub Copilot |

**IDE hooks/MCP config** also cover Windsurf and JetBrains Copilot (via `.github/hooks/`), but those hosts do not yet have dedicated session adapters — L1 recall requires indexed sessions from a supported adapter.
