import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { correlateCommitToSession, correlateSessionByTimestamp } from "../../src/git/commit-correlation.js";
import { upsertSession, getLinksForSession } from "../../src/storage/sqlite.js";
import { recordCommit } from "../../src/git/linkage.js";

let tmpDir: string;
let dbPath: string;
let repoDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-corr-"));
  dbPath = join(tmpDir, "traceback.db");
  repoDir = join(tmpDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  writeFileSync(join(repoDir, "src.ts"), "export const x = 1;\n");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("commit correlation", () => {
  it("links by timestamp window when hook link missing", () => {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
    const now = Date.now();
    upsertSession(dbPath, {
      session_id: "sess-corr",
      adapter_id: "claude-code",
      project_path: repoDir,
      git_branch: "main",
      started_at: now - 60_000,
      ended_at: now,
      slug: null,
      raw_path: "/raw.jsonl",
      intent: null,
      transcript_ref: "/raw.jsonl",
    });
    recordCommit(dbPath, repoDir, sha);
    const confidence = correlateCommitToSession(dbPath, repoDir, "sess-corr", sha, 30 * 60 * 1000);
    expect(confidence).toBeGreaterThan(0);
  });

  it("correlates by timestamp and editFiles overlap when no prior links", () => {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
    const now = Date.now();
    upsertSession(dbPath, {
      session_id: "sess-overlap",
      adapter_id: "claude-code",
      project_path: repoDir,
      git_branch: "main",
      started_at: now - 60_000,
      ended_at: now,
      slug: null,
      raw_path: "/raw.jsonl",
      intent: null,
      transcript_ref: "/raw.jsonl",
      metadata_json: JSON.stringify({ editFiles: ["src.ts"] }),
    });
    recordCommit(dbPath, repoDir, sha);
    correlateSessionByTimestamp(dbPath, repoDir, "sess-overlap", 30 * 60 * 1000);
    const links = getLinksForSession(dbPath, "sess-overlap");
    expect(links.some((l) => l.sha === sha)).toBe(true);
  });
});
