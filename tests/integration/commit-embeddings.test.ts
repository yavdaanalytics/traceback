import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { indexCommitsIncremental } from "../../src/git/commit-embedder.js";
import { getIndexState } from "../../src/storage/sqlite.js";
import { searchSimilarCommits } from "../../src/storage/lancedb.js";
import { embedText } from "../../src/embedding/embedder.js";

let tmpDir: string;
let dbPath: string;
let dataDir: string;
let repoDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-commit-embed-"));
  dbPath = join(tmpDir, "traceback.db");
  dataDir = join(tmpDir, "lancedb");
  repoDir = join(tmpDir, "repo");
  mkdirSync(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  writeFileSync(join(repoDir, "a.ts"), "// jwt refresh fix\n");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "fix jwt refresh token loop"], { cwd: repoDir });
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("commit embedder", () => {
  it("indexes commits incrementally and stores last_indexed_commit", async () => {
    const n = await indexCommitsIncremental(dataDir, dbPath, repoDir);
    expect(n).toBeGreaterThan(0);
    expect(getIndexState(dbPath, "last_indexed_commit")).toBeTruthy();
  }, 60_000);
});

describe("commit embeddings integration", () => {
  it("finds commit by message intent via cosine search", async () => {
    await indexCommitsIncremental(dataDir, dbPath, repoDir);
    const vector = await embedText("oauth jwt refresh logout bug");
    const hits = await searchSimilarCommits(dataDir, vector, 1);
    expect(hits.length).toBeGreaterThan(0);
  }, 60_000);
});
