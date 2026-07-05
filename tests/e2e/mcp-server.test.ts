import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drives the actual compiled MCP server over its real stdio JSON-RPC
// transport (the same protocol Claude Code/Cursor/Copilot speak), not a
// direct function import - this is what actually proves the tool
// registrations, schemas, and content shapes are wired correctly end-to-end.
const distIndex = join(process.cwd(), "dist", "mcp", "index.js");

let repoDir: string;
let proc: ChildProcessWithoutNullStreams;
let buffer = "";
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
let nextId = 1;

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
  repoDir = mkdtempSync(join(tmpdir(), "traceback-e2e-"));
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  writeFileSync(join(repoDir, "readme.txt"), "hello world\n");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });

  proc = spawn("node", [distIndex], { cwd: repoDir, stdio: ["pipe", "pipe", "pipe"] });
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
    clientInfo: { name: "vitest-e2e", version: "0" },
  });
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
}, 30_000);

afterAll(() => {
  proc.kill();
  try {
    rmSync(repoDir, { recursive: true, force: true });
  } catch {
    // best-effort - see tests/unit/sqlite.test.ts
  }
});

describe("MCP protocol wiring", () => {
  it("lists all 14 registered tools with valid JSON schemas", async () => {
    const result = await send("tools/list");
    const names = result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(
      [
        "ast_search",
        "blame_current",
        "find_similar_sessions",
        "get_commit_context",
        "get_efficiency_report",
        "get_session_lineage",
        "git_history_scope",
        "ingest_session",
        "link_session_commit",
        "list_adapters",
        "search_sessions_grep",
        "search_with_fallback",
        "submit_feedback",
        "tag_outcome",
      ].sort(),
    );
    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("list_adapters returns the three known adapters", async () => {
    const result = await callTool("list_adapters", {});
    const adapters = JSON.parse(result.content[0].text);
    expect(adapters.map((a: { id: string }) => a.id).sort()).toEqual(["claude-code", "copilot", "cursor"]);
  });

  it("find_similar_sessions returns an empty array (no LanceDB index in a fresh repo) without erroring", async () => {
    const result = await callTool("find_similar_sessions", { query: "anything", top_k: 5 });
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it("get_efficiency_report reflects the calls made so far in this session", async () => {
    const result = await callTool("get_efficiency_report", {});
    expect(result.content[0].text).toContain("find_similar_sessions");
  });

  it("submit_feedback records a verdict end-to-end and returns the expected shape", async () => {
    const result = await callTool("submit_feedback", { session_id: "no-such-session", verdict: "confirm" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.feedback_id).toBeGreaterThan(0);
    expect(parsed.penalized_session_ids).toEqual([]);
  });

  it("tag_outcome then get_commit_context round-trips through real git + sqlite", async () => {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
    const tagResult = await callTool("tag_outcome", { commit_sha: sha, outcome: "kept" });
    expect(tagResult.content[0].text).toContain(sha);

    const contextResult = await callTool("get_commit_context", { commit_sha: sha });
    const context = JSON.parse(contextResult.content[0].text);
    expect(context.outcome?.outcome ?? context.outcome).toBeDefined();
  });

  it("an invalid tool call (unknown tool name) surfaces isError, not a crash", async () => {
    const result = await send("tools/call", { name: "not_a_real_tool", arguments: {} });
    expect(result.isError).toBe(true);
    // Server must still be alive afterward.
    const list = await send("tools/list");
    expect(list.tools.length).toBeGreaterThan(0);
  });
});
