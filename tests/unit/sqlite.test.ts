import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  upsertSession,
  getSession,
  upsertCommit,
  getCommit,
  linkSessionCommit,
  getLinksForSession,
  getLinksForCommit,
  addFileTouched,
  getFilesForCommit,
  setOutcome,
  getOutcome,
  addRelation,
  getRelatedCommits,
  insertToolInvocation,
  getToolInvocation,
  queryInvocations,
  insertFeedback,
  getPenaltyWeight,
  incrementPenaltyWeight,
} from "../../src/storage/sqlite.js";

// One temp DB path for most of this file, for consistency with prior runs -
// getDb() now caches a DatabaseSync per resolved path (see "multiple db paths"
// describe block below), so reusing one path throughout is a convention here,
// not a requirement.
let dbPath: string;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-sqlite-test-"));
  dbPath = join(tmpDir, "traceback.db");
});

afterAll(() => {
  // node:sqlite's DatabaseSync is never explicitly closed (getDb() caches it
  // for the process lifetime), so its WAL file handle can still be open on
  // Windows when this runs - best-effort cleanup, not a correctness check.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore - OS temp dir, not a leak that matters
  }
});

describe("schema bootstrap", () => {
  it("creates the DB file and all tables on first open, idempotently on repeat calls", () => {
    expect(() => getSession(dbPath, "nonexistent")).not.toThrow();
    expect(() => getSession(dbPath, "nonexistent")).not.toThrow();
  });
});

describe("sessions", () => {
  it("upserts and reads back a session row", () => {
    upsertSession(dbPath, {
      session_id: "s1",
      adapter_id: "claude-code",
      project_path: "/repo",
      git_branch: "main",
      started_at: 1000,
      ended_at: 2000,
      slug: "fix-bug",
      raw_path: "/raw/s1.jsonl",
      intent: "fix the bug",
    });
    const row = getSession(dbPath, "s1");
    expect(row?.session_id).toBe("s1");
    expect(row?.adapter_id).toBe("claude-code");
    expect(row?.project_path).toBe("/repo");
  });

  it("updates fields on conflict instead of duplicating the row", () => {
    upsertSession(dbPath, {
      session_id: "s1",
      adapter_id: "cursor",
      project_path: "/repo2",
      git_branch: "dev",
      started_at: 1000,
      ended_at: 3000,
      slug: "fix-bug",
      raw_path: "/raw/s1.jsonl",
      intent: "fix the bug",
    });
    const row = getSession(dbPath, "s1");
    expect(row?.adapter_id).toBe("cursor");
    expect(row?.project_path).toBe("/repo2");
    expect(row?.ended_at).toBe(3000);
  });

  it("returns undefined for a session that doesn't exist", () => {
    expect(getSession(dbPath, "does-not-exist")).toBeUndefined();
  });
});

describe("penalty_weight migration column", () => {
  it("defaults to 0 for a freshly inserted session", () => {
    upsertSession(dbPath, {
      session_id: "penalty-s1",
      adapter_id: "claude-code",
      project_path: "/repo",
      git_branch: null,
      started_at: null,
      ended_at: null,
      slug: null,
      raw_path: "/raw/p1.jsonl",
      intent: null,
    });
    expect(getPenaltyWeight(dbPath, "penalty-s1")).toBe(0);
  });

  it("returns 0 for a session_id that was never inserted (no crash on missing row)", () => {
    expect(getPenaltyWeight(dbPath, "never-existed")).toBe(0);
  });

  it("increments cumulatively across repeated calls", () => {
    incrementPenaltyWeight(dbPath, "penalty-s1", 0.2);
    expect(getPenaltyWeight(dbPath, "penalty-s1")).toBeCloseTo(0.2);
    incrementPenaltyWeight(dbPath, "penalty-s1", 0.2);
    expect(getPenaltyWeight(dbPath, "penalty-s1")).toBeCloseTo(0.4);
  });

  it("is a no-op (does not throw or create a row) for a nonexistent session", () => {
    expect(() => incrementPenaltyWeight(dbPath, "still-never-existed", 0.2)).not.toThrow();
    expect(getPenaltyWeight(dbPath, "still-never-existed")).toBe(0);
  });
});

describe("commits, links, files, relations, outcomes", () => {
  it("round-trips a commit row", () => {
    upsertCommit(dbPath, { sha: "abc123", repo_path: "/repo", author_date: 5000, message: "fix jwt skew", parent_sha: null });
    const row = getCommit(dbPath, "abc123");
    expect(row?.sha).toBe("abc123");
    expect(row?.message).toBe("fix jwt skew");
  });

  it("does not overwrite an existing commit on conflict (INSERT ... DO NOTHING)", () => {
    upsertCommit(dbPath, { sha: "abc123", repo_path: "/repo", author_date: 9999, message: "different message", parent_sha: null });
    const row = getCommit(dbPath, "abc123");
    expect(row?.author_date).toBe(5000);
    expect(row?.message).toBe("fix jwt skew");
  });

  it("links a session to a commit both directions are queryable", () => {
    linkSessionCommit(dbPath, { session_id: "s1", sha: "abc123", link_source: "hook", linked_at: 6000, confidence: 0.9 });
    expect(getLinksForSession(dbPath, "s1")).toEqual([{ sha: "abc123", link_source: "hook", confidence: 0.9 }]);
    expect(getLinksForCommit(dbPath, "abc123")).toEqual([{ session_id: "s1", link_source: "hook", confidence: 0.9 }]);
  });

  it("updates link_source/confidence on a repeat link (manual override of a hook guess)", () => {
    linkSessionCommit(dbPath, { session_id: "s1", sha: "abc123", link_source: "manual", linked_at: 7000, confidence: 1.0 });
    expect(getLinksForSession(dbPath, "s1")).toEqual([{ sha: "abc123", link_source: "manual", confidence: 1.0 }]);
  });

  it("tracks files touched by a commit", () => {
    addFileTouched(dbPath, { sha: "abc123", file_path: "src/auth.ts", change_type: "modified" });
    addFileTouched(dbPath, { sha: "abc123", file_path: "src/jwt.ts", change_type: "added" });
    expect(getFilesForCommit(dbPath, "abc123").sort()).toEqual(["src/auth.ts", "src/jwt.ts"]);
  });

  it("sets and reads a commit outcome", () => {
    setOutcome(dbPath, { sha: "abc123", outcome: "kept", derived_at: 8000, evidence: "no revert within 30d" });
    expect(getOutcome(dbPath, "abc123")?.outcome).toBe("kept");
  });

  it("records commit relations and looks them up symmetrically", () => {
    upsertCommit(dbPath, { sha: "def456", repo_path: "/repo", author_date: 6000, message: "revert jwt fix", parent_sha: "abc123" });
    addRelation(dbPath, { sha: "def456", related_sha: "abc123", relation: "reverts" });
    const fromRelated = getRelatedCommits(dbPath, "abc123");
    expect(fromRelated).toEqual(expect.arrayContaining([{ sha: "def456", relation: "reverts" }]));
    const fromSha = getRelatedCommits(dbPath, "def456");
    expect(fromSha).toEqual(expect.arrayContaining([{ sha: "abc123", relation: "reverts" }]));
  });
});

describe("tool_invocations", () => {
  const baseRow = {
    tool_name: "find_similar_sessions",
    mcp_method_name: "tools/call",
    input_args: JSON.stringify({ query: "jwt skew" }),
    started_at: 10_000,
    duration_ms: 12.3,
    ok: 1,
    error_message: null,
    git_depth_days: 4.5,
    matched_ref: "s1",
    delta_window_scale: 3,
    warm_lines_pulled: 180,
    global_lines_skipped: 45_020,
    baseline_lines: 45_200,
  };

  it("inserts and returns an auto-incremented invocation_id", () => {
    const id = insertToolInvocation(dbPath, baseRow);
    expect(id).toBeGreaterThan(0);
    const fetched = getToolInvocation(dbPath, id);
    expect(fetched?.tool_name).toBe("find_similar_sessions");
    expect(fetched?.baseline_lines).toBe(45_200);
  });

  it("returns undefined for a nonexistent invocation_id", () => {
    expect(getToolInvocation(dbPath, 999_999)).toBeUndefined();
  });

  it("filters by toolName and since", () => {
    insertToolInvocation(dbPath, { ...baseRow, tool_name: "ast_search", started_at: 20_000 });
    const all = queryInvocations(dbPath, {});
    expect(all.length).toBeGreaterThanOrEqual(2);

    const onlyAst = queryInvocations(dbPath, { toolName: "ast_search" });
    expect(onlyAst.every((r) => r.tool_name === "ast_search")).toBe(true);

    const sinceLate = queryInvocations(dbPath, { since: 15_000 });
    expect(sinceLate.every((r) => r.started_at >= 15_000)).toBe(true);
  });
});

describe("multiple db paths in one process", () => {
  it("keeps two distinct sqlite paths independently queryable", () => {
    const dbPathA = join(tmpDir, "repo-a.db");
    const dbPathB = join(tmpDir, "repo-b.db");

    upsertSession(dbPathA, {
      session_id: "repo-a-session",
      adapter_id: "claude-code",
      project_path: "/repo-a",
      git_branch: null,
      started_at: null,
      ended_at: null,
      slug: null,
      raw_path: "/raw/a.jsonl",
      intent: null,
    });
    upsertSession(dbPathB, {
      session_id: "repo-b-session",
      adapter_id: "claude-code",
      project_path: "/repo-b",
      git_branch: null,
      started_at: null,
      ended_at: null,
      slug: null,
      raw_path: "/raw/b.jsonl",
      intent: null,
    });

    expect(getSession(dbPathA, "repo-a-session")?.project_path).toBe("/repo-a");
    expect(getSession(dbPathA, "repo-b-session")).toBeUndefined();
    expect(getSession(dbPathB, "repo-b-session")?.project_path).toBe("/repo-b");
    expect(getSession(dbPathB, "repo-a-session")).toBeUndefined();
  });
});

describe("feedback", () => {
  it("inserts a feedback row and returns an id", () => {
    const id = insertFeedback(dbPath, {
      invocation_id: null,
      session_id: "s1",
      verdict: "reject",
      note: "wrong session",
      created_at: 30_000,
    });
    expect(id).toBeGreaterThan(0);
  });

  it("rejects a verdict outside the CHECK constraint", () => {
    expect(() =>
      insertFeedback(dbPath, {
        invocation_id: null,
        session_id: "s1",
        // @ts-expect-error deliberately invalid to test the CHECK constraint
        verdict: "maybe",
        note: null,
        created_at: 31_000,
      }),
    ).toThrow();
  });
});
