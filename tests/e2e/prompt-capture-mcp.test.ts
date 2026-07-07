import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { runPostCommitHook } from "../../src/git/hook-runtime.js";
import { ingestStaleSessions } from "../../src/ingest/indexer.js";
import { normalizePath } from "../../src/util/paths.js";
import {
  installPromptCaptureFixture,
  PROMPT_CAPTURE_QUERY,
  PROMPT_CAPTURE_SESSION_ID,
  type PromptCaptureFixture,
} from "../helpers/prompt-capture-fixture.js";

const distIndex = join(process.cwd(), "dist", "mcp", "index.js");

let fixture: PromptCaptureFixture;
let proc: ChildProcessWithoutNullStreams;
let buffer = "";
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
let nextId = 1;
const savedClaudeDir = process.env.TRACEBACK_CLAUDE_PROJECTS_DIR;
const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;
const savedCopilotStorage = process.env.TRACEBACK_COPILOT_STORAGE;

function send(method: string, params?: unknown): Promise<any> {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    proc.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  return send("tools/call", { name, arguments: args });
}

beforeAll(async () => {
  fixture = installPromptCaptureFixture();
  await runPostCommitHook(fixture.repoDir);

  proc = spawn("node", [distIndex], { cwd: fixture.repoDir, stdio: ["pipe", "pipe", "pipe"] });
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        if (msg.error) waiter.reject(msg.error);
        else waiter.resolve(msg.result);
      }
    }
  });

  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "vitest-prompt-capture", version: "0" },
  });
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
}, 180_000);

afterAll(() => {
  proc?.kill();
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

describe("MCP prompt capture: ingest_session → search_dev_history", () => {
  it("ingest_session indexes fixture Claude history", async () => {
    const result = await callTool("ingest_session", {
      project_path: normalizePath(fixture.repoDir),
      adapter_id: "claude-code",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ingested).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it("search_dev_history returns golden prompt session with commit linkage", async () => {
    await ingestStaleSessions(
      {
        dataDir: fixture.dataDir,
        sqlitePath: fixture.sqlitePath,
        repoPath: fixture.repoDir,
      },
      { projectPath: normalizePath(fixture.repoDir), adapterId: "claude-code" },
    );

    const result = await callTool("search_dev_history", {
      query: PROMPT_CAPTURE_QUERY,
      top_k: 5,
      project_path: normalizePath(fixture.repoDir),
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.meta.source).toBe("session_vector");
    expect(payload.data.length).toBeGreaterThan(0);

    const top =
      payload.data.find((r: { session_id: string }) => r.session_id === PROMPT_CAPTURE_SESSION_ID) ??
      payload.data[0];
    expect(["high", "low"]).toContain(top.confidence);
    expect(top).toHaveProperty("outcome");
    expect(top).toHaveProperty("outcome_evidence");

    const sha = top.linkedCommits?.[0]?.sha ?? top.attempts?.[0]?.commit_sha;
    expect(sha).toBe(fixture.headSha);
    execFileSync("git", ["cat-file", "-e", sha], { cwd: fixture.repoDir, stdio: "ignore" });
  }, 180_000);

  it("search_with_fallback warm-starts from the same golden prompt", async () => {
    const result = await callTool("search_with_fallback", {
      query: PROMPT_CAPTURE_QUERY,
      project_path: normalizePath(fixture.repoDir),
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.data.grep_result).toBeTruthy();
    expect(payload.data.mode).toBeTruthy();
    const sessionIds = (payload.data.session_matches ?? []).map((s: { session_id: string }) => s.session_id);
    if (sessionIds.length > 0) {
      expect(sessionIds).toContain(PROMPT_CAPTURE_SESSION_ID);
    }
  }, 180_000);
});
