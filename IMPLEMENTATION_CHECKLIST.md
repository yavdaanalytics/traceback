# Traceback v1.1 Implementation Checklist

Use this checklist after implementation to verify scope and spot gaps against `TOKEN_REDUCTION_IMPLEMENTATION.md`.

## 1) Acceptance Criteria

- [ ] `search_with_fallback` returns summarized payload (not full raw fallback dump)
- [ ] `intent_summary` is included when intent/session context exists
- [ ] `grep_result` output is capped, ranked, and deduped per file
- [ ] docs/comments are excluded by default for L3 grep unless query requests docs
- [ ] lazy detail tools exist: `get_match_details`, `get_commit_files`
- [ ] token telemetry fields are recorded in `tool_invocations`
- [ ] pattern tools exist: `promote_pattern`, `list_patterns`, `deprecate_pattern`
- [ ] proactive pattern suggestions are present in summarized warm-start response
- [ ] discovery tool exists: `get_traceback_status`
- [ ] deferred items are explicitly listed in `ROADMAP.md`

## 2) File Map

### New files

- `src/mcp/payload-formatter.ts`
- `src/mcp/grep-pattern.ts`
- `src/mcp/result-ranking.ts`
- `src/mcp/match-details.ts`
- `src/mcp/pattern-suggest.ts`
- `src/mcp/status.ts`
- `tests/unit/payload-formatter.test.ts`
- `tests/unit/grep-pattern.test.ts`
- `tests/unit/result-ranking.test.ts`
- `tests/unit/pattern-suggest.test.ts`
- `tests/unit/status.test.ts`

### Updated files

- `src/mcp/index.ts`
- `src/mcp/fallback.ts`
- `src/mcp/search.ts`
- `src/mcp/telemetry.ts`
- `src/mcp/connection-info.ts`
- `src/storage/sqlite.ts`
- `src/cli/warm-start-format.ts`
- `src/cli/setup.ts`
- `tests/e2e/mcp-server.test.ts`
- `ROADMAP.md`
- `TOKEN_REDUCTION_IMPLEMENTATION.md`

## 3) API Contract (search_with_fallback)

Expected top-level shape:

- `mode`
- `grep_summary` (`hits_shown`, `total_hits`, `files_touched`, ...)
- `grep_results` (capped snippets)
- `git_scope` summarized commits (`hash`, `message`, `file_count`, ...)
- `intent_summary` (sessions + intent commits)
- `relevant_patterns` (when available)
- `layers`, `source_labels`, `source_label`
- optional refinement blocks only when non-empty

## 4) Telemetry Fields

`tool_invocations` must include:

- `response_chars`
- `response_tokens_est`
- `baseline_tokens_est`
- `layer4_skipped`

`get_efficiency_report` must include both line-reduction and token summaries when available.

## 5) Security Invariants

- [ ] No string-interpolated shell commands introduced
- [ ] `searchGrep` uses argv arrays with `execFileSync`
- [ ] `get_match_details` validates repo-relative paths before file reads
- [ ] existing regression security tests still pass

## 6) Intent Regression Checks

- [ ] L1/L2 still use full natural-language query for embeddings
- [ ] only L3 pattern derivation applies stop-word narrowing
- [ ] intent commit signals are preserved in output

## 7) Discovery Smoke Tests

- [ ] `get_traceback_status` appears in tool list
- [ ] `get_traceback_status` returns discovery hints and tool counts
- [ ] `get_connection_info` includes discovery fields

## 8) Golden Before/After Token Fixture

Query: `"is warm-start grep implemented?"`

- Before: full payload path (raw grep + full git scope)
- After: summarized payload path (ranked/capped hits + summarized git scope)
- Verify payload length and token estimate reduction is directionally significant.

## 9) Known Deferred Gaps

These remain deferred to roadmap:

- output token budget parameter
- factual fast-path mode
- L2.5 change-graph summary in fallback
- explicit `agent_called_get_details` metric
- tokenizer upgrade beyond chars/4 estimate
- host-native deferred-schema auto-load integrations
