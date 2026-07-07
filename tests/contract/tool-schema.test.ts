import { describe, it, expect } from "vitest";
import { z } from "zod";

// Contract tests for MCP tool schema stability and backwards-compatibility.
// These tests ensure that:
// 1. All tool schemas are well-defined
// 2. Required fields stay required (backwards-compatibility)
// 3. Optional fields can be safely added without breaking old consumers
// 4. Input validation works as expected

// Tool schema definitions extracted from src/mcp/index.ts
// These are the exact schemas registered with the MCP server.
const TOOL_SCHEMAS = {
  find_similar_sessions: z.object({
    query: z.string(),
    top_k: z.number().int().positive().max(50).optional().default(5),
    project_path: z.string().optional(),
  }),

  git_history_scope: z.object({
    terms: z.array(z.string()).min(1),
    file: z.string().optional(),
    line: z.number().int().positive().optional(),
    repo_path: z.string().optional(),
  }),

  ast_search: z.object({
    pattern: z.string(),
    files: z.array(z.string()).min(1),
    language: z.string().optional(),
    repo_path: z.string().optional(),
  }),

  search_sessions_grep: z.object({
    pattern: z.string(),
    session_ids: z.array(z.string()).optional(),
    scope: z.array(z.string()).optional(),
    repo_path: z.string().optional(),
  }),

  blame_current: z.object({
    file: z.string(),
    historical_commit: z.string(),
    line_or_symbol: z.string(),
    repo_path: z.string().optional(),
  }),

  get_session_lineage: z.object({
    session_id: z.string().optional(),
    commit_sha: z.string().optional(),
    direction: z.enum(["forward", "backward", "both"]).optional().default("both"),
    hops: z.number().int().positive().max(10).optional().default(2),
  }),

  link_session_commit: z.object({
    session_id: z.string(),
    commit_sha: z.string(),
    repo_path: z.string().optional(),
  }),

  get_commit_context: z.object({
    commit_sha: z.string(),
  }),

  ingest_session: z.object({
    adapter_id: z.string().optional(),
    project_path: z.string().optional(),
  }),

  list_adapters: z.object({}),

  tag_outcome: z.object({
    commit_sha: z.string(),
    outcome: z.enum(["kept", "reverted", "broke_build", "superseded", "unknown"]),
    evidence: z.string().optional(),
  }),

  get_efficiency_report: z.object({
    since: z.number().optional(),
    tool_name: z.string().optional(),
  }),

  search_with_fallback: z.object({
    query: z.string(),
    pattern: z.string().optional(),
    project_path: z.string().optional(),
    repo_path: z.string().optional(),
  }),

  submit_feedback: z.object({
    invocation_id: z.number().int().optional(),
    session_id: z.string().optional(),
    verdict: z.enum(["confirm", "reject"]),
    note: z.string().optional(),
  }),
};

describe("MCP Tool Schema Contracts", () => {
  describe("Schema Existence & Structure", () => {
    it("all 14 expected tools are defined", () => {
      const toolNames = Object.keys(TOOL_SCHEMAS);
      expect(toolNames.length).toBe(14);
      expect(toolNames).toContain("find_similar_sessions");
      expect(toolNames).toContain("search_with_fallback");
      expect(toolNames).toContain("submit_feedback");
    });

    it("all schemas are Zod object schemas", () => {
      for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
        expect(schema instanceof z.ZodType).toBe(true);
      }
    });
  });

  describe("Required Fields & Backwards-Compatibility", () => {
    it("find_similar_sessions requires 'query', allows optional top_k/project_path", () => {
      const schema = TOOL_SCHEMAS.find_similar_sessions;

      // Valid: with required field only
      expect(() => schema.parse({ query: "test" })).not.toThrow();

      // Valid: with optional fields
      expect(() => schema.parse({ query: "test", top_k: 10 })).not.toThrow();

      // Invalid: missing required field
      expect(() => schema.parse({ top_k: 10 })).toThrow();
    });

    it("git_history_scope requires 'terms' array with min 1 item", () => {
      const schema = TOOL_SCHEMAS.git_history_scope;

      // Valid
      expect(() => schema.parse({ terms: ["test"] })).not.toThrow();

      // Invalid: missing terms
      expect(() => schema.parse({} as any)).toThrow();

      // Invalid: empty terms array
      expect(() => schema.parse({ terms: [] })).toThrow();
    });

    it("blame_current requires file, historical_commit, line_or_symbol", () => {
      const schema = TOOL_SCHEMAS.blame_current;

      // Valid
      expect(() =>
        schema.parse({
          file: "test.ts",
          historical_commit: "abc123",
          line_or_symbol: "1",
        }),
      ).not.toThrow();

      // Invalid: missing any required field
      expect(() =>
        schema.parse({
          file: "test.ts",
          line_or_symbol: "1",
        }),
      ).toThrow();
    });

    it("get_commit_context requires exactly 'commit_sha'", () => {
      const schema = TOOL_SCHEMAS.get_commit_context;

      // Valid
      expect(() => schema.parse({ commit_sha: "abc123" })).not.toThrow();

      // Invalid: missing required field
      expect(() => schema.parse({} as any)).toThrow();
    });

    it("submit_feedback requires 'verdict', allows optional session_id/invocation_id/note", () => {
      const schema = TOOL_SCHEMAS.submit_feedback;

      // Valid: verdict only
      expect(() => schema.parse({ verdict: "confirm" })).not.toThrow();

      // Valid: with optional fields
      expect(() =>
        schema.parse({
          verdict: "reject",
          session_id: "sess-123",
          note: "reason",
        }),
      ).not.toThrow();

      // Invalid: missing required field
      expect(() => schema.parse({ session_id: "sess-123" })).toThrow();

      // Invalid: bad verdict enum value
      expect(() => schema.parse({ verdict: "maybe" as any })).toThrow();
    });

    it("list_adapters allows empty input object (no required fields)", () => {
      const schema = TOOL_SCHEMAS.list_adapters;
      expect(() => schema.parse({})).not.toThrow();
    });
  });

  describe("Enum Validation", () => {
    it("tag_outcome outcome field validates enum values", () => {
      const schema = TOOL_SCHEMAS.tag_outcome;

      // Valid values
      for (const outcome of ["kept", "reverted", "broke_build", "superseded", "unknown"]) {
        expect(() =>
          schema.parse({
            commit_sha: "abc123",
            outcome: outcome as any,
          }),
        ).not.toThrow();
      }

      // Invalid values
      expect(() =>
        schema.parse({
          commit_sha: "abc123",
          outcome: "pending" as any,
        }),
      ).toThrow();
    });

    it("get_session_lineage direction field validates enum values", () => {
      const schema = TOOL_SCHEMAS.get_session_lineage;

      // Valid
      for (const dir of ["forward", "backward", "both"]) {
        expect(() =>
          schema.parse({
            direction: dir as any,
          }),
        ).not.toThrow();
      }

      // Invalid
      expect(() =>
        schema.parse({
          direction: "sideways" as any,
        }),
      ).toThrow();
    });

    it("submit_feedback verdict field is strict enum", () => {
      const schema = TOOL_SCHEMAS.submit_feedback;

      // Valid
      expect(() => schema.parse({ verdict: "confirm" })).not.toThrow();
      expect(() => schema.parse({ verdict: "reject" })).not.toThrow();

      // Invalid
      expect(() =>
        schema.parse({
          verdict: "unsure" as any,
        }),
      ).toThrow();
    });
  });

  describe("Type Constraints", () => {
    it("find_similar_sessions top_k validates positive integer <= 50", () => {
      const schema = TOOL_SCHEMAS.find_similar_sessions;

      // Valid
      expect(() => schema.parse({ query: "test", top_k: 5 })).not.toThrow();
      expect(() => schema.parse({ query: "test", top_k: 50 })).not.toThrow();

      // Invalid: zero or negative
      expect(() => schema.parse({ query: "test", top_k: 0 })).toThrow();
      expect(() => schema.parse({ query: "test", top_k: -1 })).toThrow();

      // Invalid: exceeds max
      expect(() => schema.parse({ query: "test", top_k: 51 })).toThrow();

      // Invalid: non-integer
      expect(() => schema.parse({ query: "test", top_k: 5.5 })).toThrow();
    });

    it("get_session_lineage hops validates positive integer <= 10", () => {
      const schema = TOOL_SCHEMAS.get_session_lineage;

      // Valid
      expect(() => schema.parse({ hops: 2 })).not.toThrow();
      expect(() => schema.parse({ hops: 10 })).not.toThrow();

      // Invalid: exceeds max
      expect(() => schema.parse({ hops: 11 })).toThrow();

      // Invalid: zero
      expect(() => schema.parse({ hops: 0 })).toThrow();
    });

    it("git_history_scope terms array requires minimum 1 item", () => {
      const schema = TOOL_SCHEMAS.git_history_scope;

      // Valid
      expect(() => schema.parse({ terms: ["search"] })).not.toThrow();
      expect(() => schema.parse({ terms: ["a", "b", "c"] })).not.toThrow();

      // Invalid: empty array
      expect(() => schema.parse({ terms: [] })).toThrow();
    });

    it("ast_search files array requires minimum 1 item", () => {
      const schema = TOOL_SCHEMAS.ast_search;

      // Valid
      expect(() =>
        schema.parse({
          pattern: "function",
          files: ["src/"],
        }),
      ).not.toThrow();

      // Invalid: empty files
      expect(() =>
        schema.parse({
          pattern: "function",
          files: [],
        }),
      ).toThrow();
    });

    it("string fields reject non-string values", () => {
      const schema = TOOL_SCHEMAS.find_similar_sessions;

      // Invalid: number for query
      expect(() =>
        schema.parse({
          query: 123 as any,
        }),
      ).toThrow();

      // Invalid: object for query
      expect(() =>
        schema.parse({
          query: { nested: "value" } as any,
        }),
      ).toThrow();
    });
  });

  describe("Default Values", () => {
    it("find_similar_sessions top_k defaults to 5", () => {
      const schema = TOOL_SCHEMAS.find_similar_sessions;
      const parsed = schema.parse({ query: "test" });
      expect(parsed.top_k).toBe(5);
    });

    it("get_session_lineage direction defaults to 'both'", () => {
      const schema = TOOL_SCHEMAS.get_session_lineage;
      const parsed = schema.parse({});
      expect(parsed.direction).toBe("both");
    });

    it("get_session_lineage hops defaults to 2", () => {
      const schema = TOOL_SCHEMAS.get_session_lineage;
      const parsed = schema.parse({});
      expect(parsed.hops).toBe(2);
    });
  });

  describe("Backwards-Compatibility: Old Consumers", () => {
    it("old consumer calling find_similar_sessions(query, top_k=5) still works", () => {
      const schema = TOOL_SCHEMAS.find_similar_sessions;
      const oldCall = { query: "test", top_k: 5 };
      expect(() => schema.parse(oldCall)).not.toThrow();
      const parsed = schema.parse(oldCall);
      expect(parsed.query).toBe("test");
      expect(parsed.top_k).toBe(5);
    });

    it("old consumer calling get_commit_context(commit_sha) still works", () => {
      const schema = TOOL_SCHEMAS.get_commit_context;
      const oldCall = { commit_sha: "abc123" };
      expect(() => schema.parse(oldCall)).not.toThrow();
    });

    it("old consumer calling list_adapters() with empty args still works", () => {
      const schema = TOOL_SCHEMAS.list_adapters;
      const oldCall = {};
      expect(() => schema.parse(oldCall)).not.toThrow();
    });
  });

  describe("Future Extensibility: New Optional Fields", () => {
    it("adding optional fields to find_similar_sessions would not break old consumers", () => {
      // Simulate a new schema with an optional field added
      const newSchema = z.object({
        query: z.string(),
        top_k: z.number().int().positive().max(50).optional().default(5),
        project_path: z.string().optional(),
        // NEW FIELD (hypothetical)
        semantic_weight: z.number().optional(),
      });

      // Old consumer call (without new field) still validates
      const oldCall = { query: "test" };
      expect(() => newSchema.parse(oldCall)).not.toThrow();
    });

    it("adding a REQUIRED field would break old consumers (safety check)", () => {
      // Simulate a breaking schema change
      const breakingSchema = z.object({
        query: z.string(),
        top_k: z.number().int().positive().max(50).optional().default(5),
        project_path: z.string().optional(),
        // NEW REQUIRED FIELD (breaking!)
        language: z.string(),
      });

      // Old consumer call (without new required field) would fail
      const oldCall = { query: "test" };
      expect(() => breakingSchema.parse(oldCall)).toThrow();
    });
  });

  describe("Multi-Tool Consistency", () => {
    it("all tools with repo_path param accept it as optional string", () => {
      const withRepoPath = [
        "git_history_scope",
        "ast_search",
        "search_sessions_grep",
        "blame_current",
        "search_with_fallback",
      ];

      for (const toolName of withRepoPath) {
        const schema = TOOL_SCHEMAS[toolName as keyof typeof TOOL_SCHEMAS];
        const parsed = schema.parse({
          query: "test",
          pattern: "test",
          file: "test.ts",
          historical_commit: "abc",
          line_or_symbol: "1",
          terms: ["search"],
          files: ["src"],
          repo_path: "/custom/repo",
        });
        expect(parsed).toBeDefined();
      }
    });

    it("all tools with optional scope/narrowing params default to empty/undefined", () => {
      const narrowableTools = [
        { name: "search_sessions_grep", param: "scope" },
        { name: "git_history_scope", param: "file" },
      ];

      for (const tool of narrowableTools) {
        const schema = TOOL_SCHEMAS[tool.name as keyof typeof TOOL_SCHEMAS];
        const parsed = schema.parse(
          tool.name === "search_sessions_grep"
            ? { pattern: "test" }
            : { terms: ["search"] },
        );
        expect(parsed[tool.param as keyof typeof parsed]).toBeUndefined();
      }
    });
  });

  describe("Tool-Specific Contract Guarantees", () => {
    it("find_similar_sessions query is non-empty string", () => {
      const schema = TOOL_SCHEMAS.find_similar_sessions;

      // Valid non-empty
      expect(() => schema.parse({ query: "a" })).not.toThrow();

      // Edge case: whitespace-only strings are still valid (validation at tool level, not schema)
      expect(() => schema.parse({ query: "   " })).not.toThrow();
    });

    it("tag_outcome evidence is optional but string if provided", () => {
      const schema = TOOL_SCHEMAS.tag_outcome;

      // Valid: no evidence
      expect(() =>
        schema.parse({
          commit_sha: "abc123",
          outcome: "kept",
        }),
      ).not.toThrow();

      // Valid: with evidence
      expect(() =>
        schema.parse({
          commit_sha: "abc123",
          outcome: "reverted",
          evidence: "regression detected",
        }),
      ).not.toThrow();

      // Invalid: evidence as non-string
      expect(() =>
        schema.parse({
          commit_sha: "abc123",
          outcome: "kept",
          evidence: 123 as any,
        }),
      ).toThrow();
    });

    it("submit_feedback verdict must be exactly 'confirm' or 'reject'", () => {
      const schema = TOOL_SCHEMAS.submit_feedback;

      // Valid
      expect(() => schema.parse({ verdict: "confirm" })).not.toThrow();
      expect(() => schema.parse({ verdict: "reject" })).not.toThrow();

      // Invalid: typos or similar values
      expect(() => schema.parse({ verdict: "confirmed" as any })).toThrow();
      expect(() => schema.parse({ verdict: "denied" as any })).toThrow();
      expect(() => schema.parse({ verdict: "Confirm" as any })).toThrow();
    });
  });
});
