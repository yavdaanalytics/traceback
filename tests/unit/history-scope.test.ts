import { describe, it, expect } from "vitest";
import { deriveSearchTerms } from "../../src/git/history-scope.js";

describe("history-scope", () => {
  describe("deriveSearchTerms", () => {
    it("extracts quoted substrings", () => {
      const terms = deriveSearchTerms('find "error handling" in the code');
      expect(terms).toContain("error handling");
    });

    it("extracts path-like tokens", () => {
      const terms = deriveSearchTerms("problem in src/mcp/index.ts");
      expect(terms).toContain("src/mcp/index.ts");
    });

    it("extracts identifier-like tokens (snake_case)", () => {
      const terms = deriveSearchTerms("bug in get_commit_context function");
      expect(terms).toContain("get_commit_context");
    });

    it("extracts identifier-like tokens (camelCase)", () => {
      const terms = deriveSearchTerms("issue with gitHistoryScope logic");
      expect(terms).toContain("gitHistoryScope");
    });

    it("extracts identifier-like tokens (ALL_CAPS)", () => {
      const terms = deriveSearchTerms("error in DEFAULT_CONFIDENCE_THRESHOLD constant");
      expect(terms).toContain("DEFAULT_CONFIDENCE_THRESHOLD");
    });

    it("falls back to longest words when no special tokens exist", () => {
      const terms = deriveSearchTerms("how do i fix this problem");
      expect(terms.length).toBeGreaterThan(0);
      // Should pick longer words like "problem", "this"
      expect(terms.some((t) => t.length >= 3)).toBe(true);
    });

    it("caps output at 5 terms", () => {
      const terms = deriveSearchTerms(
        "term1 term2 term3 term4 term5 term6 term7 " + 'with "quoted" things and path/like/tokens',
      );
      expect(terms.length).toBeLessThanOrEqual(5);
    });

    it("returns empty array for empty query", () => {
      const terms = deriveSearchTerms("");
      expect(terms.length).toBe(0);
    });
  });
});
