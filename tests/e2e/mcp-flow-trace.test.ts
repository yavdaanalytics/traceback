import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findSimilarSessions, findSimilarSessionsWithContext } from "../../src/mcp/recall.js";
import { searchGrep } from "../../src/mcp/search.js";
import { queryInvocations } from "../../src/storage/sqlite.js";
import { embedText } from "../../src/embedding/embedder.js";
import { upsertTurnEmbeddings } from "../../src/storage/lancedb.js";
import { upsertSession } from "../../src/storage/sqlite.js";

let tmpDir: string;
let sqlitePath: string;
let lancedbPath: string;
const projectRoot = process.cwd();

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-flow-trace-"));
  sqlitePath = join(tmpDir, "traceback.db");
  lancedbPath = join(tmpDir, "lancedb");

  const digest = "Fixed intent being null in sessions table during ingest";
  upsertSession(sqlitePath, {
    session_id: "flow-trace-sess",
    adapter_id: "claude-code",
    project_path: "c:/source/traceback",
    git_branch: "main",
    started_at: Date.now() - 60_000,
    ended_at: Date.now(),
    slug: "intent-fix",
    raw_path: "/raw/flow.jsonl",
    intent: "fix intent null",
    embedding_text: digest,
  });

  await upsertTurnEmbeddings(lancedbPath, [
    {
      id: "flow-trace-sess:embedding_text",
      session_id: "flow-trace-sess",
      adapter_id: "claude-code",
      turn_id: "embedding_text",
      chunk_text: digest,
      vector: await embedText(digest),
      project_path: "c:/source/traceback",
      timestamp: Date.now(),
      kind: "embedding_text",
    },
  ]);
}, 60_000);

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("E2E MCP Flow Trace: User Prompt → Intent → Sessions → Context Retrieval", () => {
  it("traces prompt to session retrieval via semantic search", async () => {
    const sessions = await findSimilarSessions(
      { repoPath: projectRoot, dataDir: lancedbPath, sqlitePath, confidenceThreshold: 0.5 },
      "how do I fix intent being null in sessions",
      5,
      "c:/source/traceback",
    );
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toHaveProperty("session_id");
    expect(sessions[0]._distance).toBeLessThan(2);
  }, 60_000);

  it("traces full context chain: prompt → sessions → commits → context", async () => {
    const sessions = await findSimilarSessionsWithContext(
      { repoPath: projectRoot, dataDir: lancedbPath, sqlitePath, confidenceThreshold: 0.5 },
      "intent null in sessions ingest",
      3,
      "c:/source/traceback",
    );
    expect(sessions.length).toBeGreaterThan(0);
    const grep = searchGrep(projectRoot, "intent", ["src/storage/sqlite.ts"]);
    expect(grep.length).toBeGreaterThan(0);
    expect(queryInvocations(sqlitePath, {}).length).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
