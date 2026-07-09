import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rmSync } from "node:fs";
import { ingestStaleSessions } from "../../src/ingest/indexer.js";
import { getSession } from "../../src/storage/sqlite.js";
import { normalizePath } from "../../src/util/paths.js";
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

describe("ingestStaleSessions with real CursorAdapter", () => {
  it("ingests sessions despite NULL vscdb rows in another workspace", async () => {
    const result = await ingestStaleSessions(
      {
        dataDir: fixture.dataDir,
        sqlitePath: fixture.sqlitePath,
        repoPath: fixture.repoDir,
      },
      { adapterId: "cursor", projectPath: normalizePath(fixture.repoDir) },
    );

    expect(result.ingested).toBeGreaterThan(0);
    const session = getSession(fixture.sqlitePath, CURSOR_INGEST_SESSION_ID);
    expect(session).toBeDefined();
    expect(session!.adapter_id).toBe("cursor");
    expect(session!.embedding_text).toContain("OAuth");
  });
});
