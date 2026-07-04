import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { submitFeedback, PENALTY_STEP } from "../../src/mcp/feedback.js";
import { upsertSession, getPenaltyWeight, insertToolInvocation } from "../../src/storage/sqlite.js";

let dbPath: string;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-feedback-test-"));
  dbPath = join(tmpDir, "traceback.db");

  upsertSession(dbPath, {
    session_id: "sess-a",
    adapter_id: "claude-code",
    project_path: "/repo",
    git_branch: null,
    started_at: null,
    ended_at: null,
    slug: null,
    raw_path: "/raw/a.jsonl",
    intent: null,
  });
});

afterAll(() => {
  // Best-effort - see the matching comment in tests/unit/sqlite.test.ts.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("submitFeedback - confirm", () => {
  it("records the feedback row but penalizes nothing", () => {
    const before = getPenaltyWeight(dbPath, "sess-a");
    const result = submitFeedback(dbPath, { sessionId: "sess-a", verdict: "confirm" });
    expect(result.feedback_id).toBeGreaterThan(0);
    expect(result.penalized_session_ids).toEqual([]);
    expect(getPenaltyWeight(dbPath, "sess-a")).toBe(before);
  });
});

describe("submitFeedback - reject via explicit session_id", () => {
  it("penalizes exactly that session by PENALTY_STEP", () => {
    const before = getPenaltyWeight(dbPath, "sess-a");
    const result = submitFeedback(dbPath, { sessionId: "sess-a", verdict: "reject", note: "wrong match" });
    expect(result.penalized_session_ids).toEqual(["sess-a"]);
    expect(getPenaltyWeight(dbPath, "sess-a")).toBeCloseTo(before + PENALTY_STEP);
  });

  it("silently skips penalizing a session_id that was never ingested", () => {
    const result = submitFeedback(dbPath, { sessionId: "ghost-session", verdict: "reject" });
    // Still reports it as "resolved" (explicit sessionId always wins)...
    expect(result.penalized_session_ids).toEqual(["ghost-session"]);
    // ...but no row exists to bump, so nothing blows up and nothing is created.
    expect(getPenaltyWeight(dbPath, "ghost-session")).toBe(0);
  });
});

describe("submitFeedback - reject via invocation_id fallback", () => {
  it("resolves session_id from the recorded input_args of the referenced invocation", () => {
    const invocationId = insertToolInvocation(dbPath, {
      tool_name: "find_similar_sessions",
      mcp_method_name: "tools/call",
      input_args: JSON.stringify({ session_id: "sess-a", query: "jwt skew" }),
      started_at: Date.now(),
      duration_ms: 5,
      ok: 1,
      error_message: null,
      git_depth_days: null,
      matched_ref: "sess-a",
      delta_window_scale: null,
      warm_lines_pulled: null,
      global_lines_skipped: null,
      baseline_lines: null,
    });
    const before = getPenaltyWeight(dbPath, "sess-a");
    const result = submitFeedback(dbPath, { invocationId, verdict: "reject" });
    expect(result.penalized_session_ids).toEqual(["sess-a"]);
    expect(getPenaltyWeight(dbPath, "sess-a")).toBeCloseTo(before + PENALTY_STEP);
  });

  it("resolves a session_ids array from input_args (multi-session tool calls)", () => {
    upsertSession(dbPath, {
      session_id: "sess-b",
      adapter_id: "claude-code",
      project_path: "/repo",
      git_branch: null,
      started_at: null,
      ended_at: null,
      slug: null,
      raw_path: "/raw/b.jsonl",
      intent: null,
    });
    const invocationId = insertToolInvocation(dbPath, {
      tool_name: "search_sessions_grep",
      mcp_method_name: "tools/call",
      input_args: JSON.stringify({ session_ids: ["sess-a", "sess-b"], pattern: "jwt" }),
      started_at: Date.now(),
      duration_ms: 5,
      ok: 1,
      error_message: null,
      git_depth_days: null,
      matched_ref: null,
      delta_window_scale: null,
      warm_lines_pulled: null,
      global_lines_skipped: null,
      baseline_lines: null,
    });
    const result = submitFeedback(dbPath, { invocationId, verdict: "reject" });
    expect(result.penalized_session_ids.sort()).toEqual(["sess-a", "sess-b"]);
  });

  it("records feedback but penalizes nothing when the invocation has no session_id/session_ids", () => {
    const invocationId = insertToolInvocation(dbPath, {
      tool_name: "ast_search",
      mcp_method_name: "tools/call",
      input_args: JSON.stringify({ pattern: "foo", files: ["a.ts"] }),
      started_at: Date.now(),
      duration_ms: 5,
      ok: 1,
      error_message: null,
      git_depth_days: null,
      matched_ref: null,
      delta_window_scale: null,
      warm_lines_pulled: null,
      global_lines_skipped: null,
      baseline_lines: null,
    });
    const result = submitFeedback(dbPath, { invocationId, verdict: "reject" });
    expect(result.penalized_session_ids).toEqual([]);
  });

  it("records feedback but penalizes nothing when neither invocation_id nor session_id is given", () => {
    const result = submitFeedback(dbPath, { verdict: "reject" });
    expect(result.penalized_session_ids).toEqual([]);
    expect(result.feedback_id).toBeGreaterThan(0);
  });

  it("does not throw when invocation_id references a nonexistent invocation", () => {
    expect(() => submitFeedback(dbPath, { invocationId: 999_999, verdict: "reject" })).not.toThrow();
  });
});
