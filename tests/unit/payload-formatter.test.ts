import { describe, expect, it } from "vitest";
import { serializeForMCP, summarizeFallbackForAgent } from "../../src/mcp/payload-formatter.js";
import type { FallbackResult } from "../../src/mcp/fallback.js";

const base: FallbackResult = {
  mode: "cold_start_git_scoped",
  grep_result: "src/a.ts:1:// comment\nsrc/a.ts:2:const a = 1;\nREADME.md:3:text\n",
  layers: [],
  git_scope: [{ commit_hash: "abc", files_changed: ["src/a.ts", "README.md"], signals: ["intent"], message: "m" }],
  refinements: {},
  source_labels: ["grep_scoped"],
  source_label: "grep_scoped",
};

describe("payload formatter", () => {
  it("filters comment lines and caps grep results", () => {
    const summary = summarizeFallbackForAgent(base, { maxGrepLines: 1 });
    const grepSummary = summary.grep_summary as { hits_shown: number; total_hits: number; total_hits_before_filter: number };
    expect(grepSummary.hits_shown).toBe(1);
    expect(grepSummary.total_hits_before_filter).toBe(3);
    expect(grepSummary.total_hits).toBe(2);
  });

  it("produces compact JSON shorter than pretty JSON", () => {
    const summary = summarizeFallbackForAgent(base, {});
    const compact = serializeForMCP(summary, true);
    const pretty = serializeForMCP(summary, false);
    expect(compact.length).toBeLessThan(pretty.length);
  });
});

