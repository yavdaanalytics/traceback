import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/git/commit-embedder.js", () => ({ kickOffCommitEmbeddingIndex: vi.fn() }));
vi.mock("../../src/mcp/search.js", () => ({ searchGrep: vi.fn(() => "") }));
vi.mock("../../src/mcp/recall.js", () => ({ findSimilarSessions: vi.fn(async () => []) }));
vi.mock("../../src/git/history-scope.js", () => ({
  deriveSearchTerms: vi.fn(() => ["jwt"]),
  gitHistoryScope: vi.fn(() => []),
  enrichGitScopeWithIntent: vi.fn(async (r: unknown[]) => r),
}));
vi.mock("../../src/ast/symbol-search.js", () => ({
  astSymbolSearch: vi.fn(async () => "(no matches)"),
}));
vi.mock("../../src/mcp/code-search.js", () => ({
  diffSearch: vi.fn(() => ""),
  keywordSearch: vi.fn(() => "TODO: fix"),
}));

import { searchGrep } from "../../src/mcp/search.js";
import { searchWithFallback } from "../../src/mcp/fallback.js";

describe("search_with_fallback layers", () => {
  beforeEach(() => {
    vi.mocked(searchGrep).mockReset();
  });

  it("includes L4 layer tags when widening to full repo", async () => {
    vi.mocked(searchGrep).mockReturnValueOnce("").mockReturnValueOnce("src/a.ts:1:match");
    const result = await searchWithFallback(
      { repoPath: process.cwd(), dataDir: "/tmp/lance", sqlitePath: "/tmp/db", confidenceThreshold: 0.35 },
      { query: "jwt refresh bug" },
    );
    expect(result.layers.some((l) => l.layer === 4)).toBe(true);
    expect(result.source_labels).toContain("keyword_search");
  });

  it("emits trigger diagnostics for ambiguous prompts", async () => {
    vi.mocked(searchGrep).mockReturnValueOnce("src/a.ts:1:match");
    const result = await searchWithFallback(
      {
        repoPath: process.cwd(),
        dataDir: "/tmp/lance",
        sqlitePath: "/tmp/db",
        confidenceThreshold: 0.35,
        keywordRouterEnabled: true,
        keywordStrongThreshold: 2.2,
        keywordWeakThreshold: 0.8,
      },
      { query: "why is this broken" },
    );
    expect(result.trigger_diagnostics).toBeDefined();
    expect(result.trigger_diagnostics?.decision).toMatch(/strong|weak|skip/);
  });
});
