# traceback

Semantic debugger MCP server: helps LLM agents find the right code *fast* by warming up grep with embedding-based context recall, turning a blind O(repo) search into a scoped O(session) search.

## The Problem

When an agent hits a bug or question — "why is this authentication failing?" — the only tools it has are `grep` and `git blame`. Both suffer the same fatal flaw: they're scope-blind. A naive `git grep "token"` across a 100K-line repo returns hundreds of hits, 95% noise. The agent either drowns in context or makes a lucky guess.

traceback solves this by asking: *"has the agent worked on this kind of problem before?"* If yes, that past session becomes a **scope anchor** — the files touched, commits made, even the conversation intent. Now grep runs against a pre-scoped window. Instead of 45,200 candidate lines, you search 180 lines. That's a 250x reduction in noise, all deterministic, all local, all free.

## Architecture: The Warm-Start Funnel

traceback doesn't replace grep — it stages *before* grep:

```
┌─────────────────────────────────────────────────────────────────┐
│ Query: "jwt token expiry causing 401 errors"                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                    ┌────▼─────────────────────┐
                    │ 1. SEMANTIC RECALL       │
                    │ (embedding + ANN search) │
                    │ "find similar sessions"  │
                    │ ~15ms ──────────────────►│ "sess-jwt-fix from 3 weeks ago"
                    └────┬──────────────────────┘
                         │
                    ┌────▼──────────────────────┐
                    │ 2. SCOPE NARROWING       │
                    │ (git blame + file track) │
                    │ extract linked commits   │
                    │ ~5ms ─────────────────────│ files: [src/auth.ts, src/jwt.ts]
                    └────┬──────────────────────┘
                         │
                    ┌────▼──────────────────────┐
                    │ 3. PRECISION SEARCH      │
                    │ (ast-grep, git grep)     │
                    │ search only narrowed set │
                    │ ~10ms ────────────────────│ 3 matches in scope
                    └────┬──────────────────────┘
                         │
                    ┌────▼─────────────────────────────┐
                    │ Result: 3 hits vs 450 from blind │
                    │ grep. Agent can read all 3.      │
                    └──────────────────────────────────┘
```

**Each stage feeds the next.** If semantic recall returns no result, the agent still has git/grep as a fallback (wider scope, same tool). If the narrowed scope misses a match, it can widen. The funnel doesn't cut off options; it *sequences* them.

### 1. Semantic Recall: Finding the Right Session

When you work on a bug, you're working *in a session* — a coding-agent session stored as a transcript. traceback indexes these sessions via embeddings (locally, using `fastembed` / `all-MiniLM-L6-v2`), stores them in LanceDB, and uses **cosine-similarity ANN search** to find the most contextually-relevant past session for a new query.

Why embeddings?
- **Fuzzy matching**: "jwt timeout" and "token expiry" are semantically the same; a regex won't catch both.
- **No manual tagging**: the embedding model learns from the raw session text — no need for humans to tag bugs as "auth", "performance", etc.
- **Local & free**: `fastembed` runs entirely offline; zero API calls, zero inference cost, purely CPU-bound.

The downside: quality is bounded by the embedding model. A model trained mostly on English prose may not catch domain-specific code patterns. But a small, local model beats nothing, and beats a keyword search.

### 2. Scope Narrowing: From Session to Files

Once a semantic match finds the right session, traceback traces the session backwards through git: which commits were made during that session? Which files did those commits touch? Those files become the **search scope**.

Why git-based scope?
- **Authoritative**: git blame is the source of truth. If a commit doesn't exist in history, it doesn't belong in scope.
- **Cheap**: no custom graph traversal. `git log` and `git diff` already answer "which files were touched."
- **Debuggable**: an agent can see the commits and files traceback used, verify they make sense, and manually override if needed.

The query is now *scoped* — "find 'token' in [auth.ts, jwt.ts]" instead of "find 'token' anywhere in the repo."

### 3. Precision Search: Exact Match in Scope

With files in hand, the agent runs its chosen precision tool — `ast-grep` for structural matches (survives refactoring), `git grep` for exact text, even `git blame` to trace an individual line. All tools now work on a pre-filtered candidate set.

**Result**: 3 matches instead of 450, all high-signal.

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

When the agent gets a match wrong (semantic recall pointed at the wrong session), it can submit feedback: `submit_feedback(session_id, verdict="reject")`. traceback then **down-weights that session's future ranking** — not deleting it, just making it less likely to surface next time. This is a lightweight form of HITL loop: the system learns from human corrections without requiring retraining.

View telemetry with `get_efficiency_report` — live metrics on call counts, average latency, line-reduction %, average git-history depth.

## All Local, All Free

- **No API calls**: embeddings run offline via `fastembed`.
- **No external services**: LanceDB is embedded, SQLite is embedded, git is already on the machine.
- **No models to download**: `all-MiniLM-L6-v2` (22M parameters) downloads once on first use (~40MB).
- **Single binary**: the MCP server is Node + TypeScript, cross-platform (Claude Code, Cursor, VS Code/Copilot, Windsurf, JetBrains).
- **Installs in seconds**: `npx traceback-setup` wires the git hook and MCP config, done.

## Limitations & Trade-offs

**Scope-narrowing assumes prior work**: if you've never worked on JWT issues before, traceback can't narrow scope. Graceful degradation: the agent falls back to blind grep. This is fine — warm-start is a *bonus*, not a requirement.

**Embedding model quality**: `all-MiniLM-L6-v2` is general-purpose; it may miss domain-specific nuances. A finance codebase might benefit from a model trained on financial data. Swappable, but not done in v1.

**No cross-repo scope**: traceback indexes one repo at a time (matching its per-repo install model). Multi-repo queries would need cross-repo session indexing — deferred.

**Manual override required**: if traceback makes a wrong call, the agent must explicitly widen scope or call a different tool. No automatic fallback (by design — keeps the agent in control).

## Quick Install

```sh
cd your-repo
npx traceback-setup
```

This installs the git post-commit hook and merges traceback into your editor's MCP config (`.mcp.json`, `.cursor/mcp.json`, or `.vscode/mcp.json` — whichever exists).

For manual setup or unsupported clients, see the [full install guide](https://github.com/anthropics/traceback#installation).

## Development

```sh
npm run build              # compile TypeScript
npm test                   # full test suite (59 tests across unit/integration/e2e/regression/evals)
npm run bench               # performance benchmarks at 1k/5k/10k-row scale
npm run security:sast       # static analysis (requires `pip install semgrep`)
npm run security:audit      # dependency audit
```

See `CLAUDE.md` for testing details, architecture notes, and the hard security rule (command-injection prevention via `execFileSync` argv arrays, not string interpolation).

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

## Future Roadmap

See `ROADMAP.md` (local file, not published) for deferred features like the **Engineering Episode** model (richer versioning than commits), **Rust rewrite** (multi-repo concurrency), and **time-travel UX** (jump directly to a resolved session/commit range).

## Contributing

This is an early-stage tool. Feedback, bug reports, and PRs are welcome. Key areas where traceback could improve:
- Better embedding models or fine-tuning for code.
- Multi-repo indexing.
- Integration with other session capture systems (not just Claude Code/Cursor).
- Agent eval harness (does this actually help agents find bugs faster?).

---

Built with ❤️ by Anthropic. traceback is an MCP server — it works with any MCP-compatible LLM IDE.
