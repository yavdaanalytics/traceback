import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const distIndex = join(process.cwd(), "dist", "mcp", "index.js");

const EXPECTED_TOOLS = [
  "ast_search",
  "ast_symbol_search",
  "blame_current",
  "diff_search",
  "find_similar_sessions",
  "get_change_graph",
  "get_commit_context",
  "get_connection_info",
  "get_traceback_status",
  "get_efficiency_report",
  "get_match_details",
  "get_commit_files",
  "get_session_detail",
  "get_session_lineage",
  "git_history_scope",
  "grep_codebase",
  "ingest_session",
  "keyword_search",
  "link_session_commit",
  "list_adapters",
  "search_dev_history",
  "search_sessions_grep",
  "search_with_fallback",
  "submit_feedback",
  "tag_outcome",
  "promote_pattern",
  "list_patterns",
  "deprecate_pattern",
].sort();

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
}, 120_000);

afterAll(() => {
  proc.kill();
  try {
    rmSync(repoDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("MCP protocol wiring", () => {
  it("lists all registered tools with valid JSON schemas", async () => {
    const result = await send("tools/list");
    const names = result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
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

  it("find_similar_sessions returns labeled empty data without erroring", async () => {
    const result = await callTool("find_similar_sessions", { query: "anything", top_k: 5 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toEqual([]);
    expect(parsed.meta.certainty).toBe("probabilistic");
  }, 120_000);

  it("get_efficiency_report reflects tool calls made in this session", async () => {
    await callTool("find_similar_sessions", { query: "test", top_k: 1 });
    const result = await callTool("get_efficiency_report", {});
    expect(result.content[0].text).toMatch(/find_similar_sessions|list_adapters/);
  });

  it("submit_feedback records a verdict end-to-end", async () => {
    const result = await callTool("submit_feedback", { session_id: "no-such-session", verdict: "confirm" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.feedback_id).toBeGreaterThan(0);
  });

  it("tag_outcome then get_commit_context round-trips", async () => {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
    await callTool("tag_outcome", { commit_sha: sha, outcome: "kept" });
    const contextResult = await callTool("get_commit_context", { commit_sha: sha });
    const context = JSON.parse(contextResult.content[0].text);
    expect(context.outcome?.outcome ?? context.outcome).toBeDefined();
  });

  it("get_change_graph returns timeline shape", async () => {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
    const result = await callTool("get_change_graph", { commit_sha: sha });
    const graph = JSON.parse(result.content[0].text);
    expect(graph).toHaveProperty("timeline");
    expect(graph).toHaveProperty("context_window");
  });

  it("keyword_search smoke call", async () => {
    const result = await callTool("keyword_search", { files: ["readme.txt"] });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.meta).toBeDefined();
  });

  it("an invalid tool call surfaces isError, not a crash", async () => {
    const result = await send("tools/call", { name: "not_a_real_tool", arguments: {} });
    expect(result.isError).toBe(true);
    const list = await send("tools/list");
    expect(list.tools.length).toBeGreaterThan(0);
  });
});
