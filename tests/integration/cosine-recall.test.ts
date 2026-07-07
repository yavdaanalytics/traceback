import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { embedText } from "../../src/embedding/embedder.js";
import { upsertTurnEmbeddings, searchSimilarTurns } from "../../src/storage/lancedb.js";

let tmpDir: string;
let dataDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-cosine-"));
  dataDir = join(tmpDir, "lancedb");
  const texts = [
    "authentication token refresh loop causing logout",
    "unrelated database migration script",
  ];
  const rows = await Promise.all(
    texts.map(async (text, i) => ({
      id: `cosine-${i}`,
      session_id: `sess-${i}`,
      adapter_id: "claude-code",
      turn_id: "embedding_text",
      chunk_text: text,
      vector: await embedText(text),
      project_path: "/repo",
      timestamp: Date.now(),
      kind: "embedding_text" as const,
    })),
  );
  await upsertTurnEmbeddings(dataDir, rows);
}, 60_000);

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("cosine metric integration", () => {
  it("orders semantically closer text first with _distance in [0, 2]", async () => {
    const query = await embedText("users logged out during oauth token refresh");
    const results = await searchSimilarTurns(dataDir, query, 2);
    expect(results[0].session_id).toBe("sess-0");
    const d0 = (results[0] as unknown as { _distance: number })._distance;
    const d1 = (results[1] as unknown as { _distance: number })._distance;
    expect(d0).toBeGreaterThanOrEqual(0);
    expect(d0).toBeLessThanOrEqual(2);
    expect(d1).toBeGreaterThanOrEqual(0);
    expect(d1).toBeLessThanOrEqual(2);
    expect(d0).toBeLessThan(d1);
  });
});
