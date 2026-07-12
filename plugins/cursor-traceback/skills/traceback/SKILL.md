---
name: traceback-host-first-router
description: >-
  Warm-starts debugging and code search via the traceback MCP server
  (search_with_fallback over past agent sessions, git history, and scoped grep).
  Use when debugging, fixing bugs/regressions/errors, searching code history,
  finding where something is defined or used, recalling prior sessions/commits,
  or when the user mentions traceback, semantic recall, or session history.
  Skip only for clearly non-code prompts (weather, jokes, recipes, sports).
keywords:
  trigger:
    - debug
    - traceback
    - telemetry
    - regression
    - bug
    - error
    - fail
    - broken
    - issue
    - fix
    - session
    - history
    - commit
    - search code history
    - where is
    - find usage
    - semantic
    - recall
  concepts:
    - semantic search
    - vector similarity
    - git history
    - ast symbol
    - fallback funnel
  tools:
    - get_traceback_status
    - get_connection_info
    - search_with_fallback
    - promote_pattern
    - list_patterns
    - submit_feedback
negative_keywords:
  - weather
  - recipe
  - joke
  - movie
  - travel
  - sports
thresholds:
  strong_match: 2.2
  weak_match: 0.8
weights:
  weak_terms: 0.3
  debug_terms: 1.0
  traceback_terms: 1.5
  negative_terms: -2.0
routing_mode: balanced_host_first
routing_contract:
  strong: "Invoke traceback MCP immediately."
  weak: "Invoke traceback MCP as fallback to avoid false negatives."
  skip: "Skip only for clearly non-code/non-debug prompts."
---

# Traceback (Cursor / host skill)

Semantic warm-start over past coding-agent sessions, git history, and scoped grep.
Installed globally at `~/.cursor/skills/traceback` (and Claude `~/.claude/skills/traceback`).

## When to use (Cursor)

Apply this skill whenever the turn involves code, debugging, history, or locating definitions/usages.
Skip only greetings, thanks, mode switches, or clearly non-code topics.

## Mandatory first MCP call

1. Discover tools: `GetMcpTools` on the traceback server (or call directly if already known).
2. First tool call: `CallMcpTool` → `search_with_fallback` with:
   - `query` = the user's full message
   - `repo_path` = workspace git root
3. Do **not** call `Grep` / `Glob` / explore `Task` before that returns.

### MCP server id

| Install | `CallMcpTool` `server` |
|---------|-------------------------|
| Cursor global (`~/.cursor/mcp.json`) | `user-traceback` |
| Cursor project / plugin | `traceback` |

If "server does not exist", call `get_connection_info` on any listed traceback server and retry with `call_server_id`.

## Host-first contract

1. Evaluate prompt against keywords/weights above.
2. **strong** → call `search_with_fallback` immediately.
3. **weak/ambiguous** → still call `search_with_fallback`.
4. **skip** → only for clearly unrelated prompts.

## After warm-start

1. If `relevant_patterns` is present, **apply that guidance before any setup steps or edits** — these are distilled local warnings (env traps, unlisted prerequisites, tenant flags). Prefer them over re-deriving the lesson from a long session transcript.
2. Narrow reads/searches using `session_matches`, `git_scope`, and `grep_result`.
3. Prefer scoped traceback tools before repo-wide grep.
4. Use sessions for *where/why code changed*; use promoted patterns for *machine/tenant gotchas that never land in git*.

Other tools: `get_traceback_status`, `find_similar_sessions`, `get_session_detail`, `get_change_graph`, `blame_current`, `list_patterns`.

## Annotation memory loop (write-back)

Blank models in fresh chats have no memory of local traps. Close the loop after you resolve one:

1. **Detect** — env quirk, missing permission flag, unlisted prerequisite, or other non-obvious local gotcha that cost debugging time.
2. **Propose** — summarize a short warning for the user (title + one-line guidance + trigger phrases that should match future prompts).
3. **Persist only after explicit yes** — call `promote_pattern` with `title`, `trigger_text`, and `guidance` (same HITL contract as `submit_feedback`). Never silently promote.
4. **Recall next time** — a later blank session runs `search_with_fallback`; matching `relevant_patterns` surface the warning so the agent avoids the same mistake.

Pair with `submit_feedback(verdict="reject")` when a recalled *session* was the wrong match (down-ranks that session). Promote when the lesson itself should stick as a durable annotation.

Example shape (after user confirms):

- `title`: "Agent 365 tenant governance"
- `trigger_text`: "workiq Agent 365 Entra governance M365 Admin"
- `guidance`: "Requires tenant-level Agent 365 governance enabled in M365 Admin Center before configure succeeds."

## Tuning source of truth

- Trigger telemetry (`trigger_score`, `trigger_decision`, `trigger_terms_count`)
- `submit_feedback` outcomes
- `promote_pattern` / `list_patterns` usage (are traps being written back?)
- Efficiency report token trends

<!-- traceback-skill -->
