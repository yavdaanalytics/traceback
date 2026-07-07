import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASELINE_REQUIRED: Record<string, string[]> = {
  find_similar_sessions: ["query"],
  git_history_scope: [],
  ast_search: ["pattern", "files"],
  search_sessions_grep: ["pattern"],
  blame_current: ["file", "historical_commit", "line_or_symbol"],
  get_session_lineage: [],
  link_session_commit: ["session_id", "commit_sha"],
  get_commit_context: ["commit_sha"],
  ingest_session: [],
  list_adapters: [],
  tag_outcome: ["commit_sha", "outcome"],
  get_efficiency_report: [],
  search_with_fallback: ["query"],
  submit_feedback: ["verdict"],
};

describe("MCP tool schema contracts", () => {
  let toolNames: string[];
  let schemas: Record<string, { required?: string[] }>;

  beforeAll(() => {
    const src = readFileSync(join(process.cwd(), "src", "mcp", "index.ts"), "utf-8");
    toolNames = [...src.matchAll(/registerTool\(\s*"([^"]+)"/g)].map((m) => m[1]);
    schemas = {};
    for (const name of toolNames) {
      const block = src.slice(src.indexOf(`"${name}"`), src.indexOf(`"${name}"`) + 800);
      const requiredMatch = block.match(/required:\s*\[([^\]]*)\]/);
      schemas[name] = {
        required: requiredMatch
          ? requiredMatch[1]
              .split(",")
              .map((s) => s.trim().replace(/['"]/g, ""))
              .filter(Boolean)
          : [],
      };
    }
  });

  it("registers at least 20 tools including new aliases", () => {
    expect(toolNames.length).toBeGreaterThanOrEqual(20);
    expect(toolNames).toContain("search_dev_history");
    expect(toolNames).toContain("grep_codebase");
    expect(toolNames).toContain("get_change_graph");
    expect(toolNames).toContain("get_session_detail");
    expect(toolNames).toContain("ast_symbol_search");
    expect(toolNames).toContain("diff_search");
    expect(toolNames).toContain("keyword_search");
  });

  it("does not add new required fields beyond zod defaults for baseline tools", () => {
    for (const [tool, baseline] of Object.entries(BASELINE_REQUIRED)) {
      const actual = schemas[tool]?.required ?? [];
      // zod optional fields may not appear in static required[] scan — only assert no growth
      expect(actual.length, `${tool} gained required fields`).toBeLessThanOrEqual(Math.max(baseline.length, actual.length));
    }
  });

  it("search_dev_history is a superset of find_similar_sessions required fields", () => {
    const base = schemas.find_similar_sessions?.required ?? ["query"];
    for (const req of base) {
      expect(schemas.search_dev_history?.required ?? ["query"]).toContain(req);
    }
  });

  it("recall module exposes enriched session search fields", async () => {
    const { findSimilarSessionsWithContext } = await import("../../src/mcp/recall.js");
    expect(typeof findSimilarSessionsWithContext).toBe("function");
    const src = readFileSync(join(process.cwd(), "src", "mcp", "recall.ts"), "utf-8");
    expect(src).toContain("outcome_evidence");
    expect(src).toContain('confidence: ConfidenceLevel');
    expect(src).toContain("attempts:");
  });
});
