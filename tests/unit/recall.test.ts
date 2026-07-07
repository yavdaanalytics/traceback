import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { embedText } from "../../src/embedding/embedder.js";
import { upsertTurnEmbeddings } from "../../src/storage/lancedb.js";
import {
  upsertSession,
  linkSessionCommit,
  upsertCommit,
  setOutcome,
} from "../../src/storage/sqlite.js";
import { findSimilarSessionsWithContext } from "../../src/mcp/recall.js";

let tmpDir: string;
let sqlitePath: string;
let dataDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-recall-"));
  sqlitePath = join(tmpDir, "traceback.db");
  dataDir = join(tmpDir, "lancedb");

  const digest = "Fixed OAuth authentication token refresh loop causing logout";
  upsertSession(sqlitePath, {
    session_id: "recall-sess",
    adapter_id: "claude-code",
    project_path: "/repo",
    git_branch: "main",
    started_at: Date.now() - 60_000,
    ended_at: Date.now(),
    slug: "auth-fix",
    raw_path: "/raw/recall.jsonl",
    intent: "fix auth token",
    embedding_text: digest,
    metadata_json: JSON.stringify({ editFiles: ["src/auth.ts"], tags: ["oauth"] }),
  });

  upsertCommit(sqlitePath, {
    sha: "abc123def4567890abc123def4567890abc123de",
    repo_path: "/repo",
    author_date: Date.now(),
    message: "fix token refresh",
    parent_sha: null,
  });
  linkSessionCommit(sqlitePath, {
    session_id: "recall-sess",
    sha: "abc123def4567890abc123def4567890abc123de",
    link_source: "manual",
    linked_at: Date.now(),
    confidence: 0.95,
  });
  setOutcome(sqlitePath, {
    sha: "abc123def4567890abc123def4567890abc123de",
    outcome: "kept",
    derived_at: Date.now(),
    evidence: "tests pass",
  });

  await upsertTurnEmbeddings(dataDir, [
    {
      id: "recall-sess:embedding_text",
      session_id: "recall-sess",
      adapter_id: "claude-code",
      turn_id: "embedding_text",
      chunk_text: digest,
      vector: await embedText(digest),
      project_path: "/repo",
      timestamp: Date.now(),
      kind: "embedding_text",
    },
  ]);
}, 60_000);

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("findSimilarSessionsWithContext", () => {
  const config = {
    repoPath: "/repo",
    dataDir: "",
    sqlitePath: "",
    confidenceThreshold: 0.35,
  };

  beforeAll(() => {
    config.dataDir = dataDir;
    config.sqlitePath = sqlitePath;
  });

  it("returns confidence, outcome, outcome_evidence, and attempts", async () => {
    const results = await findSimilarSessionsWithContext(
      config,
      "oauth token refresh logout",
      3,
      "/repo",
    );
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(["high", "low"]).toContain(top.confidence);
    expect(top.outcome).toBe("kept");
    expect(top.outcome_evidence).toBe("tests pass");
    expect(top.attempts.length).toBeGreaterThan(0);
    expect(top.attempts[0].commit_sha).toBe("abc123def4567890abc123def4567890abc123de");
    expect(top.linkedCommits?.[0].outcome_evidence).toBe("tests pass");
  });

  it("filters by tags substring on metadata", async () => {
    const hit = await findSimilarSessionsWithContext(config, "oauth token", 3, "/repo", { tags: "oauth" });
    expect(hit.length).toBeGreaterThan(0);

    const miss = await findSimilarSessionsWithContext(config, "oauth token", 3, "/repo", { tags: "nonexistent-tag" });
    expect(miss).toHaveLength(0);
  });

  it("includes confidence label on every returned session", async () => {
    const results = await findSimilarSessionsWithContext(config, "unrelated database migration only", 3, "/repo");
    for (const r of results) {
      expect(["high", "low"]).toContain(r.confidence);
    }
  });
});
