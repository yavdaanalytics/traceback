import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embedText } from "../../src/embedding/embedder.js";
import { upsertTurnEmbeddings, searchSimilarTurns, type TurnEmbeddingRow } from "../../src/storage/lancedb.js";
import { upsertSession, incrementPenaltyWeight, getPenaltyWeight } from "../../src/storage/sqlite.js";

// This exercises the real recall path (fastembed model + LanceDB ANN search)
// against a fully isolated data dir/db - never the project's real data/*.
// Mirrors the penalty-aware re-sort that lives inline in find_similar_sessions
// (src/mcp/index.ts): over-fetch, add each row's penalty_weight to _distance
// (LanceDB's default ascending-L2 metric - lower is more similar, confirmed
// by reading src/storage/lancedb.ts), then re-sort ascending.
function rankWithPenalty(
  rows: TurnEmbeddingRow[],
  penaltyOf: (sessionId: string) => number,
  topK: number,
): TurnEmbeddingRow[] {
  return rows
    .map((row) => {
      const distance = (row as unknown as { _distance?: number })._distance ?? 0;
      return { row, adjusted: distance + penaltyOf(row.session_id) };
    })
    .sort((a, b) => a.adjusted - b.adjusted)
    .slice(0, topK)
    .map((w) => w.row);
}

let tmpDir: string;
let dataDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-rank-integration-"));
  dataDir = join(tmpDir, "lancedb");
  dbPath = join(tmpDir, "traceback.db");

  for (const sid of ["sess-jwt", "sess-cache", "sess-unrelated"]) {
    upsertSession(dbPath, {
      session_id: sid,
      adapter_id: "claude-code",
      project_path: "/repo",
      git_branch: null,
      started_at: null,
      ended_at: null,
      slug: null,
      raw_path: `/raw/${sid}.jsonl`,
      intent: null,
    });
  }

  const rows: TurnEmbeddingRow[] = await Promise.all(
    [
      { session_id: "sess-jwt", text: "Fixed a JWT expiry clock-skew bug causing spurious 401s" },
      { session_id: "sess-cache", text: "Investigated Redis cache invalidation race condition" },
      { session_id: "sess-unrelated", text: "Updated the README typo in the installation section" },
    ].map(async (t, i) => ({
      id: `${t.session_id}:turn-${i}`,
      session_id: t.session_id,
      adapter_id: "claude-code",
      turn_id: `turn-${i}`,
      chunk_text: t.text,
      vector: await embedText(t.text),
      project_path: "/repo",
      timestamp: Date.now(),
      kind: "turn_summary" as const,
    })),
  );
  await upsertTurnEmbeddings(dataDir, rows);
}, 60_000);

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort - see tests/unit/sqlite.test.ts
  }
});

describe("recall + penalty re-sort against real embeddings", () => {
  it("finds the semantically closest session first with no penalties applied", async () => {
    const query = await embedText("agent hit 401 errors because of a JWT expiration time bug");
    const raw = await searchSimilarTurns(dataDir, query, 3);
    expect(raw[0].session_id).toBe("sess-jwt");
  });

  it("demotes a rejected session below a previously-lower-ranked one after a penalty large enough to invert order", async () => {
    const query = await embedText("agent hit 401 errors because of a JWT expiration time bug");
    const raw = await searchSimilarTurns(dataDir, query, 3);
    expect(raw[0].session_id).toBe("sess-jwt");

    const gapToSecond = (raw[1]._distance ?? 0) - (raw[0]._distance ?? 0);
    // Apply a penalty comfortably larger than the observed gap so the
    // reordering is deterministic regardless of the exact embedding values.
    incrementPenaltyWeight(dbPath, "sess-jwt", gapToSecond + 0.05);

    const reranked = rankWithPenalty(raw, (sid) => getPenaltyWeight(dbPath, sid), 3);
    expect(reranked[0].session_id).not.toBe("sess-jwt");
    expect(reranked.map((r) => r.session_id)).toContain("sess-jwt");
  });

  it("adding a penalty smaller than the gap to the next result does not change rank 1", async () => {
    const query = await embedText("investigating a Redis invalidation race");
    const raw = await searchSimilarTurns(dataDir, query, 3);
    expect(raw[0].session_id).toBe("sess-cache");

    const gapToSecond = (raw[1]._distance ?? 0) - (raw[0]._distance ?? 0);
    incrementPenaltyWeight(dbPath, "sess-cache", Math.max(0, gapToSecond / 2));

    const reranked = rankWithPenalty(raw, (sid) => getPenaltyWeight(dbPath, sid), 3);
    expect(reranked[0].session_id).toBe("sess-cache");
  });

  it("restricts results by project_path filter", async () => {
    const query = await embedText("jwt bug");
    const scoped = await searchSimilarTurns(dataDir, query, 5, "/repo");
    expect(scoped.length).toBeGreaterThan(0);
    const unscopedProject = await searchSimilarTurns(dataDir, query, 5, "/does-not-exist");
    expect(unscopedProject).toEqual([]);
  });
});
