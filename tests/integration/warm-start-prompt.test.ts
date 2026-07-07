import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { runWarmStart } from "../../src/cli/warm-start.js";
import { ingestStaleSessions } from "../../src/ingest/indexer.js";
import { normalizePath } from "../../src/util/paths.js";
import {
  installPromptCaptureFixture,
  PROMPT_CAPTURE_QUERY,
  PROMPT_CAPTURE_SESSION_ID,
  type PromptCaptureFixture,
} from "../helpers/prompt-capture-fixture.js";
import { runPostCommitHook } from "../../src/git/hook-runtime.js";

let fixture: PromptCaptureFixture;
const savedClaudeDir = process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;
const savedCopilotStorage = process.env.TRACEBACK_COPILOT_STORAGE;

beforeAll(async () => {
  fixture = installPromptCaptureFixture();
  await runPostCommitHook(fixture.repoDir);
  await ingestStaleSessions(
    {
      dataDir: fixture.dataDir,
      sqlitePath: fixture.sqlitePath,
      repoPath: fixture.repoDir,
    },
    { projectPath: normalizePath(fixture.repoDir), adapterId: "claude-code" },
  );
}, 180_000);

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

describe("warm-start prompt hooks (integration, real searchWithFallback)", () => {
  it("vscode UserPromptSubmit prompt runs warm-start and returns session context", async () => {
    const out = await runWarmStart({
      format: "vscode",
      repoPath: fixture.repoDir,
      stdin: { hook_event_name: "UserPromptSubmit", prompt: PROMPT_CAPTURE_QUERY },
    });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(PROMPT_CAPTURE_SESSION_ID);
    expect(parsed.hookSpecificOutput.additionalContext.length).toBeGreaterThan(20);
  }, 120_000);

  it("cursor beforeReadFile hook scopes warm-start to the file path", async () => {
    const out = await runWarmStart({
      format: "cursor-read",
      repoPath: fixture.repoDir,
      stdin: { file_path: "src/auth.ts" },
    });
    const parsed = JSON.parse(out);
    expect(parsed.additional_context).toBeTruthy();
    expect(parsed.additional_context).toMatch(/auth|session|grep|git/i);
  }, 120_000);

  it("windsurf pre_user_prompt injects warm-start text", async () => {
    const out = await runWarmStart({
      format: "windsurf",
      repoPath: fixture.repoDir,
      stdin: { tool_info: { user_prompt: PROMPT_CAPTURE_QUERY } },
    });
    expect(out).toContain(PROMPT_CAPTURE_SESSION_ID);
  }, 120_000);

  it("plain CLI warm-start returns structured fallback payload", async () => {
    const out = await runWarmStart({
      format: "plain",
      repoPath: fixture.repoDir,
      query: PROMPT_CAPTURE_QUERY,
    });
    const parsed = JSON.parse(out);
    expect(parsed.data).toBeDefined();
    expect(parsed.context).toContain(PROMPT_CAPTURE_SESSION_ID);
  }, 120_000);
});
