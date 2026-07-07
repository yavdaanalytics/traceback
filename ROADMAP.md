# traceback ROADMAP

Client-facing deferred work and known scalability/security concerns.

## Deferred feature-list items

- **Type-aware search** — structural types and generics in recall queries (beyond ast_symbol_search regex/WASM)
- **Data flow tracing** — follow symbol/data flow across files and commits
- **Coverage-aware search** — prioritize files/commits with test coverage overlap
- **Exception-aware search** — correlate stack traces and error messages with sessions
- **Cross-repo submodules** — lineage and recall across git submodules
- **Cross-worktree lineage** — session/commit graph when the same repo has multiple worktrees

## Client concerns

### Scalability

- Multi-repo dashboard aggregation (`traceback-dashboard`) — LanceDB `getConnection()` still caches on first dir per process; multiplexing fix deferred
- Session volume growth — cosine `embedding_text`-only indexing reduces row count; monitor LanceDB table size

### Performance

- SLA budgets in `scripts/bench.mjs` (p95/p99) for SQLite, LanceDB cosine search, commit_embeddings
- Background commit embedding indexer throttling on first `git_history_scope` / `search_with_fallback` call
- AST parse cache under `data/ast/` keyed by `(file_path, content_hash)`

### Security

- SAST via `npm run security:sast` (Semgrep, argv-only rule)
- All git/grep shell-outs use `execFileSync` with argv arrays — no shell interpolation
- `transcript_ref` / `get_session_detail` path traversal guards (repo-root validation)
- Archive copies under `data/archive/` — optional encryption opt-in (not implemented)

## Episode model

Deferred: `supersedes` / `superseded_by` relations and episode-level grouping across segments.

## Rust rewrite

Considered and deferred — TypeScript/Node chosen for `npx` zero-friction MCP install.
