import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCursorProjectsTranscriptFixture } from "../../src/adapters/cursor.js";
import { encodeCursorProjectDir } from "../../src/adapters/path-encoding.js";
import { defaultDataDir, defaultSqlitePath, ingestStaleSessions } from "../../src/ingest/indexer.js";
import { getSession } from "../../src/storage/sqlite.js";
import { normalizePath } from "../../src/util/paths.js";

export const CURSOR_PROJECTS_INGEST_SESSION_ID = "cursor-projects-ingest-session";

vi.mock("../../src/embedding/embedder.js", () => ({
  embedText: vi.fn(async () => Array.from(new Float32Array(384).fill(0.1))),
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map(() => Array.from(new Float32Array(384).fill(0.1))),
  ),
}));

let rootDir: string;
let repoDir: string;
let dataDir: string;
let sqlitePath: string;
const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;
const savedCursorProjects = process.env.TRACEBACK_CURSOR_PROJECTS_DIR;
const savedCopilotStorage = process.env.TRACEBACK_COPILOT_STORAGE;
const savedClaudeDir = process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), "tb-cursor-projects-ingest-"));
  repoDir = join(rootDir, "repo");
  dataDir = defaultDataDir(repoDir);
  sqlitePath = defaultSqlitePath(repoDir);
  const projectsRoot = join(rootDir, "cursor-projects");

  mkdirSync(join(repoDir, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "traceback@test.local"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Traceback Test"], { cwd: repoDir });
  writeFileSync(join(repoDir, "readme.txt"), "fixture\n", "utf-8");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });

  const projectDirName = encodeCursorProjectDir(repoDir);
  buildCursorProjectsTranscriptFixture(projectsRoot, projectDirName, CURSOR_PROJECTS_INGEST_SESSION_ID, [
    JSON.stringify({
      role: "user",
      message: { content: [{ type: "text", text: "Fix OAuth token refresh in src/app.ts" }] },
    }),
    JSON.stringify({
      role: "assistant",
      message: { content: [{ type: "text", text: "Updated the refresh handler" }] },
    }),
  ]);

  process.env.TRACEBACK_CURSOR_PROJECTS_DIR = projectsRoot;
  process.env.TRACEBACK_CURSOR_STORAGE = join(rootDir, "no-vscdb-storage");
  process.env.TRACEBACK_COPILOT_STORAGE = join(rootDir, "no-copilot-storage");
  process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = join(rootDir, "no-claude-projects");
}, 60_000);

afterAll(() => {
  if (savedCursorStorage === undefined) delete process.env.TRACEBACK_CURSOR_STORAGE;
  else process.env.TRACEBACK_CURSOR_STORAGE = savedCursorStorage;
  if (savedCursorProjects === undefined) delete process.env.TRACEBACK_CURSOR_PROJECTS_DIR;
  else process.env.TRACEBACK_CURSOR_PROJECTS_DIR = savedCursorProjects;
  if (savedCopilotStorage === undefined) delete process.env.TRACEBACK_COPILOT_STORAGE;
  else process.env.TRACEBACK_COPILOT_STORAGE = savedCopilotStorage;
  if (savedClaudeDir === undefined) delete process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
  else process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = savedClaudeDir;
  try {
    rmSync(rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("ingestStaleSessions with Cursor projects agent-transcripts", () => {
  it("ingests sessions from ~/.cursor/projects layout", async () => {
    const result = await ingestStaleSessions(
      { dataDir, sqlitePath, repoPath: repoDir },
      { adapterId: "cursor", projectPath: normalizePath(repoDir) },
    );

    expect(result.ingested).toBeGreaterThan(0);
    const session = getSession(sqlitePath, CURSOR_PROJECTS_INGEST_SESSION_ID);
    expect(session).toBeDefined();
    expect(session!.adapter_id).toBe("cursor");
    expect(session!.embedding_text).toContain("OAuth");
  });
});
