import { describe, expect, it } from "vitest";
import { suggestPatternsFromInvocations } from "../../src/mcp/pattern-suggest.js";
import type { ToolInvocationRow } from "../../src/storage/sqlite.js";

function row(input_args: string, invocation_id: number): ToolInvocationRow {
  return {
    invocation_id,
    tool_name: "search_with_fallback",
    mcp_method_name: "tools/call",
    input_args,
    started_at: Date.now(),
    duration_ms: 1,
    ok: 1,
    error_message: null,
    git_depth_days: null,
    matched_ref: null,
    delta_window_scale: null,
    warm_lines_pulled: null,
    global_lines_skipped: null,
    baseline_lines: null,
    search_mode: null,
    response_chars: null,
    response_tokens_est: null,
    baseline_tokens_est: null,
    layer4_skipped: null,
    trigger_score: null,
    trigger_decision: null,
    trigger_terms_count: null,
  };
}

describe("pattern suggestion", () => {
  it("suggests when same query repeats >=3 times", () => {
    const rows = [
      row(JSON.stringify({ query: "jwt refresh loop" }), 1),
      row(JSON.stringify({ query: "jwt refresh loop" }), 2),
      row(JSON.stringify({ query: "jwt refresh loop" }), 3),
    ];
    const suggestions = suggestPatternsFromInvocations(rows);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].suggest_promote).toBe(true);
  });
});

