import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runPostCommitHook } from "../../src/git/hook-runtime.js";
import { getLinksForSession, getSession } from "../../src/storage/sqlite.js";
import {
  CURSOR_INGEST_SESSION_ID,
  installCursorIngestFixture,
  type CursorIngestFixture,
} from "../helpers/cursor-ingest-fixture.js";

vi.mock("../../src/embedding/embedder.js", () => ({
  embedText: vi.fn(async () => Array.from(new Float32Array(384).fill(0.1))),
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map(() => Array.from(new Float32Array(384).fill(0.1))),
  ),
}));

let fixture: CursorIngestFixture;
const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;
const savedCopilotStorage = process.env.TRACEBACK_COPILOT_STORAGE;
const savedClaudeDir = process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;

beforeAll(async () => {
  fixture = installCursorIngestFixture();
  await runPostCommitHook(fixture.repoDir);
}, 60_000);

afterAll(() => {
  if (savedCursorStorage === undefined) delete process.env.TRACEBACK_CURSOR_STORAGE;
  else process.env.TRACEBACK_CURSOR_STORAGE = savedCursorStorage;
  if (savedCopilotStorage === undefined) delete process.env.TRACEBACK_COPILOT_STORAGE;
  else process.env.TRACEBACK_COPILOT_STORAGE = savedCopilotStorage;
  if (savedClaudeDir === undefined) delete process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
  else process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = savedClaudeDir;
  try {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("post-commit hook E2E (Cursor ingest path)", () => {
  it("populates sessions from Cursor storage without hook errors", () => {
    const logPath = join(fixture.repoDir, ".git", "traceback-hook.log");
    if (existsSync(logPath)) {
      const log = readFileSync(logPath, "utf-8");
      expect(log).not.toMatch(/TypeError|Cannot read properties of null/i);
    }

    const session = getSession(fixture.sqlitePath, CURSOR_INGEST_SESSION_ID);
    expect(session).toBeDefined();
    expect(session!.adapter_id).toBe("cursor");
  });

  it("links the active Cursor session to HEAD", () => {
    const links = getLinksForSession(fixture.sqlitePath, CURSOR_INGEST_SESSION_ID);
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((l) => l.sha === fixture.headSha)).toBe(true);
    expect(links.some((l) => l.link_source === "hook")).toBe(true);
  });
});
