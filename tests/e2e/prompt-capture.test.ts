import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { runPostCommitHook } from "../../src/git/hook-runtime.js";
import { ingestStaleSessions } from "../../src/ingest/indexer.js";
import { findSimilarSessionsWithContext } from "../../src/mcp/recall.js";
import { getLinksForSession, getSession } from "../../src/storage/sqlite.js";
import { normalizePath } from "../../src/util/paths.js";
import {
  installPromptCaptureFixture,
  PROMPT_CAPTURE_QUERY,
  PROMPT_CAPTURE_SESSION_ID,
  type PromptCaptureFixture,
} from "../helpers/prompt-capture-fixture.js";

let fixture: PromptCaptureFixture;
const savedClaudeDir = process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;
const savedCopilotStorage = process.env.TRACEBACK_COPILOT_STORAGE;

beforeAll(async () => {
  fixture = installPromptCaptureFixture();
  await runPostCommitHook(fixture.repoDir);
}, 120_000);

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

describe("prompt capture E2E: golden prompt → session → commit → recall", () => {
  it("post-commit hook links the active Claude session to HEAD", () => {
    const links = getLinksForSession(fixture.sqlitePath, PROMPT_CAPTURE_SESSION_ID);
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((l) => l.sha === fixture.headSha)).toBe(true);
  });

  it("ingest stores editFiles metadata from tool calls", async () => {
    await ingestStaleSessions(
      {
        dataDir: fixture.dataDir,
        sqlitePath: fixture.sqlitePath,
        repoPath: fixture.repoDir,
      },
      { projectPath: normalizePath(fixture.repoDir), adapterId: "claude-code" },
    );
    const session = getSession(fixture.sqlitePath, PROMPT_CAPTURE_SESSION_ID);
    expect(session).toBeDefined();
    const meta = JSON.parse(session!.metadata_json ?? "{}") as { editFiles?: string[] };
    expect(meta.editFiles).toContain("src/auth.ts");
    expect(session!.embedding_text).toContain("OAuth");
  }, 120_000);

  it("search_dev_history recall returns session with linked commit and confidence", async () => {
    const config = {
      repoPath: fixture.repoDir,
      dataDir: fixture.dataDir,
      sqlitePath: fixture.sqlitePath,
      confidenceThreshold: 0.35,
    };
    const results = await findSimilarSessionsWithContext(
      config,
      PROMPT_CAPTURE_QUERY,
      5,
      normalizePath(fixture.repoDir),
    );
    expect(results.length).toBeGreaterThan(0);
    const top = results.find((r) => r.session_id === PROMPT_CAPTURE_SESSION_ID) ?? results[0];
    expect(["high", "low"]).toContain(top.confidence);
    expect(top).toHaveProperty("outcome");
    expect(top).toHaveProperty("outcome_evidence");
    expect(top.attempts.length).toBeGreaterThan(0);
    const linkedSha = top.linkedCommits?.[0]?.sha ?? top.attempts[0]?.commit_sha;
    expect(linkedSha).toBe(fixture.headSha);
  }, 120_000);
});
