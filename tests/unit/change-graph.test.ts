import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { getChangeGraph } from "../../src/mcp/change-graph.js";
import { upsertSession, linkSessionCommit, upsertCommit, addFileTouched } from "../../src/storage/sqlite.js";

describe("change-graph", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "traceback-graph-"));
  const dbPath = join(tmpDir, "traceback.db");
  const repoDir = join(tmpDir, "repo");
  let sha: string;

  beforeAll(() => {
    mkdirSync(repoDir);
    writeFileSync(join(repoDir, "f.ts"), "x\n");
    execFileSync("git", ["init", "-q"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });
    sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
    upsertSession(dbPath, {
      session_id: "s-graph",
      adapter_id: "claude-code",
      project_path: repoDir,
      git_branch: null,
      started_at: Date.now(),
      ended_at: Date.now(),
      slug: null,
      raw_path: "/raw.jsonl",
      intent: null,
    });
    upsertCommit(dbPath, { sha, repo_path: repoDir, author_date: Date.now(), message: "init", parent_sha: null });
    addFileTouched(dbPath, { sha, file_path: "f.ts", change_type: "A" });
    linkSessionCommit(dbPath, { session_id: "s-graph", sha, link_source: "manual", linked_at: Date.now(), confidence: 1 });
  });

  it("returns timeline entries with connection and context_window", () => {
    const graph = getChangeGraph(dbPath, repoDir, { sessionId: "s-graph" }, { before: 1, after: 1 });
    expect(graph.timeline.length).toBeGreaterThan(0);
    expect(graph.timeline[0].connection).toMatch(/direct|nearby/);
    expect(Array.isArray(graph.context_window)).toBe(true);
    expect(graph.timeline[0]).toHaveProperty("edges");
  });
});
