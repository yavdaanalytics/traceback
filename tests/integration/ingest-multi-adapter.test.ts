import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rmSync } from "node:fs";
import { runIngest } from "../../src/cli/ingest.js";
import { getSession } from "../../src/storage/sqlite.js";
import {
  installMultiAdapterIngestFixture,
  MULTI_CLAUDE_SESSION_A,
  MULTI_CLAUDE_SESSION_B,
  MULTI_COPILOT_SESSION,
  MULTI_CURSOR_SESSION,
  type MultiAdapterIngestFixture,
} from "../helpers/multi-adapter-ingest-fixture.js";

vi.mock("../../src/embedding/embedder.js", () => ({
  embedText: vi.fn(async () => Array.from(new Float32Array(384).fill(0.1))),
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map(() => Array.from(new Float32Array(384).fill(0.1))),
  ),
}));

let fixture: MultiAdapterIngestFixture;
const savedClaudeDir = process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;
const savedCursorProjects = process.env.TRACEBACK_CURSOR_PROJECTS_DIR;
const savedCopilotStorage = process.env.TRACEBACK_COPILOT_STORAGE;
const savedCopilotState = process.env.TRACEBACK_COPILOT_SESSION_STATE_DIR;

beforeAll(() => {
  fixture = installMultiAdapterIngestFixture();
}, 60_000);

afterAll(() => {
  if (savedClaudeDir === undefined) delete process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
  else process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = savedClaudeDir;
  if (savedCursorStorage === undefined) delete process.env.TRACEBACK_CURSOR_STORAGE;
  else process.env.TRACEBACK_CURSOR_STORAGE = savedCursorStorage;
  if (savedCursorProjects === undefined) delete process.env.TRACEBACK_CURSOR_PROJECTS_DIR;
  else process.env.TRACEBACK_CURSOR_PROJECTS_DIR = savedCursorProjects;
  if (savedCopilotStorage === undefined) delete process.env.TRACEBACK_COPILOT_STORAGE;
  else process.env.TRACEBACK_COPILOT_STORAGE = savedCopilotStorage;
  if (savedCopilotState === undefined) delete process.env.TRACEBACK_COPILOT_SESSION_STATE_DIR;
  else process.env.TRACEBACK_COPILOT_SESSION_STATE_DIR = savedCopilotState;
  try {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("multi-adapter ingest (claude + cursor + copilot)", () => {
  it("ingests a few scoped sessions from all three adapters", async () => {
    const result = await runIngest({ repoPath: fixture.repoDir });
    expect(result.ingested).toBe(4);

    const claudeA = getSession(fixture.sqlitePath, MULTI_CLAUDE_SESSION_A);
    const claudeB = getSession(fixture.sqlitePath, MULTI_CLAUDE_SESSION_B);
    const cursor = getSession(fixture.sqlitePath, MULTI_CURSOR_SESSION);
    const copilot = getSession(fixture.sqlitePath, MULTI_COPILOT_SESSION);

    expect(claudeA?.adapter_id).toBe("claude-code");
    expect(claudeB?.adapter_id).toBe("claude-code");
    expect(cursor?.adapter_id).toBe("cursor");
    expect(copilot?.adapter_id).toBe("copilot");

    expect(claudeA?.embedding_text).toContain("OAuth");
    expect(cursor?.embedding_text).toContain("OAuth");
    expect(copilot?.embedding_text).toContain("OAuth");
  });
});
