# traceback — build spec

Standalone spec for **traceback**, an MCP server that acts as a "semantic debugger": it embeds
past coding-agent sessions (Claude Code, Cursor, Copilot, ...) so cosine similarity can jump to
the right neighborhood of conversation/commit history, then uses AST search, grep, and `git
blame` — scoped to that neighborhood — as a precision pass. Session IDs are the join key between
conversation history and git history, forming a lightweight knowledge graph (session -> commits
-> related commits -> docs/files touched -> outcome) that can be walked in either direction.

This document is self-contained: it can brief a fresh implementation without any other context.

## Problem

Two recurring questions engineers ask that today require manually grepping through years of code
and re-reading old conversations:

1. "Did I already solve this before, and where?" (reuse)
2. "What changed around this commit that might explain this bug?" (debugging)

Plain-text grep over a large repo returns thousands of lines of noise for a generic term and
overwhelms an LLM agent's context window. Cosine similarity over past sessions can instead say
"look at session X, six months ago, same class of problem" — narrowing grep's search space to a
handful of files/commits before it even runs ("warm-started grep", not a fallback — grep gets
handed a small, precise territory instead of the whole repo).

## Retrieval funnel

Two related orderings:

### `search_with_fallback` (implemented — single MCP call)

This is the canonical warm-start path (`src/mcp/fallback.ts`):

```
L1  find_similar_sessions     (LanceDB session cosine — optional anchor)
    → if high-confidence: files from session→commit links (SQLite)
L2  git_history_scope         (git log -S pickaxe + commit intent) — ALWAYS
    → if scope empty: files from matching commits
L3  search_sessions_grep      (scoped grep → widen to git files → full repo) — ALWAYS
L4  ast_symbol_search / diff_search / keyword_search (refinements)
```

L1 may return zero hits; L2–L3 still run. L3 never hard-fails on empty scope — it widens to full-repo grep.

### Manual agent pipeline (step individual tools)

When the agent calls tools one at a time instead of `search_with_fallback`:

```
semantic (find_similar_sessions)
   -> candidate sessions/episodes
   -> candidate files (via files_touched)
   -> ast_search            (structural match: survives renames/reformatting, plain grep doesn't)
   -> search_sessions_grep  (exact token/string verification within the AST-narrowed hits)
   -> blame_current          (map the historical match to where it lives in HEAD today)
   -> current code snippet returned to the agent
```

Note: the manual pipeline runs **AST before grep**; `search_with_fallback` runs **grep (L3) before AST (L4)**. Both are valid — the orchestrated tool optimizes for fast text hits first, then structural refinements.

Each stage is cheap/fuzzy first, precise/expensive last. Vector search never has to be the final
authority — it only narrows scope; grep/AST/blame supply ground truth. If a narrow scope turns up
nothing, the caller can always widen back to a plain repo-wide search — the funnel is a sequencing
optimization, not a hard filter.

## Session adapter interface

A pluggable `SessionAdapter` per IDE/tool, normalizing everything into shared shapes so core logic
never touches source-specific formats:

```ts
interface SessionAdapter {
  id: string; // "claude-code" | "cursor" | "copilot"
  isAvailable(): boolean; // does this machine have this tool's data dir?
  listSessions(since?: number): SessionRef[]; // cheap enumeration, no full parse
  loadSession(ref: SessionRef): ParsedSession; // full parse into normalized turns
}

interface SessionRef {
  adapterId: string;
  sessionId: string;
  projectPath: string;
  lastModified: number;
  sizeHint: number;
}

interface ParsedSession {
  sessionId: string;
  adapterId: string;
  projectPath: string;
  gitBranch?: string;
  startedAt: number;
  endedAt: number;
  turns: Turn[];
}

interface Turn {
  turnId: string;
  parentTurnId?: string; // preserves tree structure where the source has one (Claude Code)
  role: "user" | "assistant";
  timestamp: number;
  text?: string;
  toolCalls: ToolCall[];
}

interface ToolCall {
  toolName: string;
  input: unknown;
  isFileEdit: boolean;
  filePath?: string;
  isShellCommand: boolean;
  command?: string;
}
```

### Claude Code adapter (v1, fully implemented — verified format)

- Sessions live at `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`, one file per session.
  `<sanitized-cwd>` is the project's absolute path with `/` and `:` replaced (e.g.
  `c:/source/traceback` -> `c--source-traceback`).
- Each line is a JSON record. Housekeeping records (`{"type":"queue-operation", ...}`) are
  ignorable. Turn records have the shape:
  `{"parentUuid", "isSidechain", "promptId", "type":"user"|"assistant", "message":{"role","content"}, "uuid", "timestamp", "cwd", "sessionId", "gitBranch", "slug"}`.
- `parentUuid` forms a linked chain/tree (sidechains branch off) — use it for turn ordering, not
  raw file line order.
- Assistant `message.content` is an array of blocks: `{"type":"thinking"}`, `{"type":"tool_use",
  "name": "Read"|"Edit"|"Bash"|..., "input": {...}}`, `{"type":"text"}`. Tool-use blocks are the
  primary substrate for "what did this session touch" (file edits, shell commands including `git
  commit`, reads/greps).
- `cwd` and `gitBranch` are stamped per-turn — no external inference needed for repo/branch
  attribution.
- `slug` is a human-readable session nickname, useful as a display name.
- Sidechain/subagent turns live in a sibling `<sessionId>/subagents/agent-*.jsonl`.

### Cursor adapter (v1, fixture-tested)

Reads `state.vscdb` from workspace/global storage via `TRACEBACK_CURSOR_STORAGE` override for tests.
Live-schema validation requires a real Cursor install (skipped in CI when absent).

### Copilot adapter (v1, fixture-tested)

Reads `chatSessions/*.json` and optional `state.vscdb` keys via `TRACEBACK_COPILOT_STORAGE` override.

## Storage: LanceDB (vectors) + SQLite (graph/relational)

LanceDB (embedded, ANN vector search) is good at cosine-similarity recall but not multi-hop
relational traversal. SQLite (`better-sqlite3`, embedded, sync, zero-install) handles the
session/commit lineage graph. Both are single-file/embedded — no server process, no extra
infrastructure to run.

### LanceDB tables

```
turn_embeddings:   { id, session_id, adapter_id, turn_id, chunk_text, vector, project_path, timestamp, kind }
commit_embeddings: { id, commit_sha, session_id?, repo_path, message, files_changed_summary, vector, timestamp }
```

`kind` on `turn_embeddings` is one of `turn_summary | tool_call | session_summary`.

### SQLite tables (`traceback.db`)

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  git_branch TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  slug TEXT,
  raw_path TEXT NOT NULL,
  intent TEXT -- nullable, manually settable, not auto-generated (see Roadmap: Episode model)
);

CREATE TABLE commits (
  sha TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  author_date INTEGER,
  message TEXT,
  parent_sha TEXT
);

CREATE TABLE session_commit_links (
  session_id TEXT NOT NULL,
  sha TEXT NOT NULL,
  link_source TEXT NOT NULL CHECK (link_source IN ('hook','manual')),
  linked_at INTEGER NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (session_id, sha)
);

CREATE TABLE commit_relations (
  sha TEXT NOT NULL,
  related_sha TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('reverts','reverted_by','fixes','follows','supersedes','superseded_by')),
  PRIMARY KEY (sha, related_sha, relation)
);

CREATE TABLE commit_outcomes (
  sha TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('kept','reverted','broke_build','superseded','unknown')),
  derived_at INTEGER,
  evidence TEXT
);

CREATE TABLE files_touched (
  sha TEXT NOT NULL,
  file_path TEXT NOT NULL,
  change_type TEXT,
  PRIMARY KEY (sha, file_path)
);

CREATE TABLE docs_touched (
  ref_id TEXT NOT NULL, -- session_id or commit sha
  file_path TEXT NOT NULL,
  PRIMARY KEY (ref_id, file_path)
);
```

`supersedes`/`superseded_by` relations and the `superseded` outcome are reserved for the future
Episode model (see Roadmap) — not populated by any v1 heuristic.

## Git linkage — no daemon

- **Post-commit hook** (`.git/hooks/post-commit`, installed per-repo, not globally): on commit,
  get `HEAD` SHA via `git rev-parse HEAD`, find the most-recently-active session for the current
  `project_path` (by session file mtime / last-turn timestamp within e.g. the last 15 minutes),
  insert a `session_commit_links` row with `link_source='hook'` and a confidence heuristic (high
  if exactly one recently-active session, lower if several candidates). Triggers the lazy
  incremental indexer for the active project first, so the session that was just active gets
  ingested at the moment of commit. Never blocks the commit: wrap everything so a failure logs to
  a local file and the hook exits 0 regardless.
- **Manual MCP tool** `link_session_commit(session_id, commit_sha, repo_path?)` corrects the
  heuristic when it's wrong (concurrent sessions, delayed commits, cherry-picks, squash-merges).
  Upserts with `link_source='manual'`, `confidence=1.0`, overriding any hook-guessed link for that
  commit.
- **No persistent daemon.** Indexing is lazy/on-demand: every retrieval tool call first does a
  cheap mtime-diff against already-indexed sessions and incrementally re-embeds only what's stale
  before running the actual query. The post-commit hook triggers the same incremental-index step.
  This is triggered by real usage (a tool call or a commit), not a background polling loop.

### Commit window / lineage

"N commits before / after a given anchor" is **not** `anchor~N..anchor^M` revision-range syntax
(`^` means *parent of a merge commit*, not "N commits forward in time" — git has no native
"forward" walk on a single branch). Implement by running `git log --pretty=%H <branch>` once,
locating the anchor SHA's index in that ordered list, and slicing N before / M after by array
index. Never construct this with shell string interpolation — see security note below.

## MCP tool surface

- `search_with_fallback(query, pattern?, project_path?, repo_path?)` — **primary warm-start tool**;
  runs the 4-layer funnel (L1 session cosine → L2 git pickaxe/intent → L3 scoped/widened grep →
  L4 ast/diff/keyword refinements) in one call. See **Retrieval funnel** above.
- `find_similar_sessions(query, top_k?, project_path?)` — L1 only: cosine search over turn/session
  embeddings; primary "which past session did X" recall.
- `ast_search(pattern, files, language?)` — structural pattern match scoped to candidate files
  from a prior semantic hit, via a proven AST-grep tool (`ast-grep` CLI) rather than a hand-rolled
  parser; catches matches plain-text grep misses (renamed vars, reformatted code, same logical
  shape).
- `search_sessions_grep(pattern, session_ids?, scope?)` — exact/regex text search, the final
  precision pass after semantic + AST narrowing.
- `blame_current(file, historical_commit, line_or_symbol)` — resolves a match found in a
  historical/candidate commit to its current location in `HEAD` via `git blame` / `git log -L
  --follow` (the matched code may have moved/been renamed/refactored since).
- `get_session_lineage(session_id_or_commit_sha, direction?, hops?)` — graph walk: ordered chain
  of linked commits/sessions before/after, including derived relations and outcome tags.
- `link_session_commit(session_id, commit_sha, repo_path?)` — manual/corrective linkage.
- `get_commit_context(commit_sha)` — reverse lookup: given a bare SHA (e.g. from `git blame`),
  return linked session(s), files/docs touched, outcome tag.
- `ingest_session(adapter_id?, session_id?, project_path?)` — explicit trigger for the lazy
  incremental indexer (backfill/troubleshooting; also called implicitly by other tools).
- `list_adapters()` — introspection: which adapters are registered/available/last-ingested.
- `tag_outcome(commit_sha, outcome, evidence?)` — manual override of outcome-tagging heuristics.

## Embedding pipeline

Embed a **templated digest**, not raw turns: user prompt text as-is; assistant turns as their
text/thinking plus a compact tool-call digest (`"Edited src/auth/login.js"`, `"Ran: npm test"`)
instead of full tool inputs/outputs (mostly noise, would bloat the index and any downstream tool
result returned to an LLM). Also embed one session-level summary (concatenation of key
prompts/text) for cheap cross-session recall. Purely extractive/templated — **no LLM call**,
keeping this fully local and free.

Model: `all-MiniLM-L6-v2` via `fastembed` (Node/ONNX runtime) — CPU-only, ~90MB one-time download,
no GPU/API dependency, no torch.

## Security requirement (non-negotiable)

Every place this tool shells out to `git`/`rg`/`ast-grep` with any value derived from an MCP tool
call argument **must** use `execFileSync`/`spawnSync` with an argument array — never a
string-interpolated `execSync`/`exec` template string. A tool-call argument (grep pattern, commit
SHA, file path) reaching a shell string is a command-injection vector.

## Stack

TypeScript/Node, distributed via `npx`. `@modelcontextprotocol/sdk` (native TS MCP SDK),
`@lancedb/lancedb`, `better-sqlite3`, `fastembed`. Chosen over Python for zero-friction `npx`
install (no venv/pip) and native fit with the MCP SDK. See ROADMAP.md for a considered-and-deferred
Rust rewrite.

## Package layout

```
traceback/
  PROMPT.md
  ROADMAP.md              # gitignored
  package.json
  src/
    mcp/                   # server entrypoint + one handler per tool above
    adapters/
      types.ts
      claude-code.ts
      cursor.ts             # stub
      copilot.ts            # stub
      registry.ts
    ingest/
      indexer.ts
      summarizer.ts
    embedding/
      embedder.ts
    storage/
      lancedb.ts
      sqlite.ts
    git/
      hook-runtime.ts
      linkage.ts
      revert-detection.ts
      commit-window.ts
    cli/
      install-hook.ts
  scripts/
    post-commit.sh
  data/                     # gitignored: lancedb/ + traceback.db
```
