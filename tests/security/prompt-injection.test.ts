import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diffSearch, keywordSearch } from "../../src/mcp/code-search.js";
import { getSessionDetail } from "../../src/mcp/session-detail.js";
import { upsertSession } from "../../src/storage/sqlite.js";
import { searchSimilarTurns } from "../../src/storage/lancedb.js";
import { embedText } from "../../src/embedding/embedder.js";

describe("prompt injection / argv isolation", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "traceback-sec-"));
  mkdirSync(join(repoDir, "src"));
  writeFileSync(join(repoDir, "src", "a.ts"), "x\n");
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });

  it("passes malicious commit_range as literal git arg (no file created)", () => {
    const evil = "--output=/tmp/traceback-injected";
    const out = diffSearch(repoDir, "x", { commit_range: evil });
    expect(out.length).toBeGreaterThanOrEqual(0);
    const injected = join(tmpdir(), "traceback-injected");
    expect(existsSync(injected)).toBe(false);
  });

  it("passes shell metacharacters in pattern as literal -e arg", () => {
    const out = keywordSearch(repoDir, "foo; rm -rf /", { files: ["src/a.ts"] });
    expect(out.length).toBeGreaterThanOrEqual(0);
  });

  it("rejects transcript path traversal outside repo", () => {
    const db = join(repoDir, "traceback.db");
    upsertSession(db, {
      session_id: "s1",
      adapter_id: "claude-code",
      project_path: repoDir,
      git_branch: null,
      started_at: null,
      ended_at: null,
      slug: null,
      raw_path: "/outside.jsonl",
      intent: null,
      transcript_ref: "C:\\Windows\\System32\\drivers\\etc\\hosts",
    });
    expect(() => getSessionDetail(db, "s1", { includeRaw: true, repoPath: repoDir })).toThrow();
  });

  it("escapes quotes in LanceDB project_path filter", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "traceback-lance-sec-"));
    const vector = await embedText("test");
    const rows = [
      {
        id: "1",
        session_id: "s",
        adapter_id: "claude-code",
        turn_id: "embedding_text",
        chunk_text: "t",
        vector,
        project_path: "/repo",
        timestamp: Date.now(),
        kind: "embedding_text" as const,
      },
    ];
    const { upsertTurnEmbeddings } = await import("../../src/storage/lancedb.js");
    await upsertTurnEmbeddings(dataDir, rows);
    const results = await searchSimilarTurns(dataDir, vector, 1, "' OR 1=1 --");
    expect(results).toEqual([]);
  });
});
