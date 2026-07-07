import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyToArchive } from "../../src/archiver/index.js";

let tmpDir: string;
let dbPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-archiver-"));
  dbPath = join(tmpDir, "traceback.db");
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("archiver", () => {
  it("copies source to data/archive and records archive_records", () => {
    const src = join(tmpDir, "session.jsonl");
    writeFileSync(src, '{"type":"user"}\n');
    const dest = copyToArchive(
      { dataDir: join(tmpDir, "lancedb"), sqlitePath: dbPath, repoPath: tmpDir },
      "claude-code",
      "sess-1",
      src,
      "test",
    );
    expect(dest).toBeDefined();
    expect(dest).toContain("archive");
  });
});
