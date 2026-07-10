import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getSession } from "../../src/storage/sqlite.js";
import {
  installPromptCaptureFixture,
  PROMPT_CAPTURE_SESSION_ID,
  type PromptCaptureFixture,
} from "../helpers/prompt-capture-fixture.js";

let fixture: PromptCaptureFixture;
const savedClaudeDir = process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;
const savedCopilotStorage = process.env.TRACEBACK_COPILOT_STORAGE;

beforeAll(() => {
  fixture = installPromptCaptureFixture();
}, 60_000);

afterAll(() => {
  if (savedClaudeDir === undefined) delete process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
  else process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = savedClaudeDir;
  if (savedCursorStorage === undefined) delete process.env.TRACEBACK_CURSOR_STORAGE;
  else process.env.TRACEBACK_CURSOR_STORAGE = savedCursorStorage;
  if (savedCopilotStorage === undefined) delete process.env.TRACEBACK_COPILOT_STORAGE;
  else process.env.TRACEBACK_COPILOT_STORAGE = savedCopilotStorage;
  try {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("traceback-ingest CLI", () => {
  it("ingests scoped sessions and writes sqlite rows", () => {
    const ingestJs = join(process.cwd(), "dist", "cli", "ingest.js");
    if (!existsSync(ingestJs)) {
      throw new Error("Run npm run build before integration tests");
    }

    const stdout = execFileSync(
      process.execPath,
      [ingestJs, "--repo", fixture.repoDir, "--adapter-id", "claude-code", "--json"],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          TRACEBACK_CLAUDE_PROJECTS_DIR: process.env.TRACEBACK_CLAUDE_PROJECTS_DIR,
          TRACEBACK_CURSOR_STORAGE: process.env.TRACEBACK_CURSOR_STORAGE,
          TRACEBACK_COPILOT_STORAGE: process.env.TRACEBACK_COPILOT_STORAGE,
        },
      },
    );

    const result = JSON.parse(stdout.trim()) as { ingested: number; skipped: number };
    expect(result.ingested).toBeGreaterThan(0);

    const session = getSession(fixture.sqlitePath, PROMPT_CAPTURE_SESSION_ID);
    expect(session).toBeDefined();
    expect(session!.adapter_id).toBe("claude-code");
  });
});
