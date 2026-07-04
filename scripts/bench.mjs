#!/usr/bin/env node
// Performance benchmark: measures latency/throughput of the two real
// bottlenecks in the warm-start funnel - SQLite tool_invocations writes and
// LanceDB ANN search - at realistic data volumes. Not a classic load test
// (traceback is a single-user local stdio process, not a concurrent network
// service); this instead answers "does this stay fast as history grows,"
// which is the actual performance question for this tool. Run via `npm run
// bench` after `npm run build`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insertToolInvocation, queryInvocations } from "../dist/storage/sqlite.js";
import { upsertTurnEmbeddings, searchSimilarTurns } from "../dist/storage/lancedb.js";
import { embedText } from "../dist/embedding/embedder.js";

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(label, samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const avg = samplesMs.reduce((s, v) => s + v, 0) / samplesMs.length;
  console.log(
    `${label}: n=${samplesMs.length} avg=${avg.toFixed(2)}ms p50=${percentile(sorted, 50).toFixed(2)}ms ` +
      `p95=${percentile(sorted, 95).toFixed(2)}ms max=${sorted[sorted.length - 1].toFixed(2)}ms`,
  );
}

async function benchSqlite(dbPath, count) {
  const insertTimes = [];
  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    insertToolInvocation(dbPath, {
      tool_name: "bench_tool",
      mcp_method_name: "tools/call",
      input_args: JSON.stringify({ i }),
      started_at: Date.now(),
      duration_ms: 1,
      ok: 1,
      error_message: null,
      git_depth_days: 1,
      matched_ref: `ref-${i}`,
      delta_window_scale: i % 10,
      warm_lines_pulled: i,
      global_lines_skipped: i * 10,
      baseline_lines: i * 11,
    });
    insertTimes.push(performance.now() - t0);
  }
  summarize(`sqlite insertToolInvocation (n=${count})`, insertTimes);

  const queryTimes = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    queryInvocations(dbPath, {});
    queryTimes.push(performance.now() - t0);
  }
  summarize(`sqlite queryInvocations (full table scan, ${count} rows, 20 runs)`, queryTimes);
}

async function benchLanceDb(dataDir, count) {
  const t0seed = performance.now();
  const baseVector = await embedText("seed vector for synthetic bench rows");
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `bench:${i}`,
    session_id: `sess-${i}`,
    adapter_id: "claude-code",
    turn_id: `turn-${i}`,
    chunk_text: `synthetic bench row ${i}`,
    // Small perturbation per row so rows aren't literally identical vectors.
    vector: baseVector.map((v, j) => v + (((i * 31 + j) % 7) - 3) * 1e-4),
    project_path: "/bench-repo",
    timestamp: Date.now(),
    kind: "turn_summary",
  }));
  await upsertTurnEmbeddings(dataDir, rows);
  console.log(`lancedb seed (n=${count}): ${(performance.now() - t0seed).toFixed(1)}ms`);

  const query = await embedText("looking for a synthetic bench row");
  const searchTimes = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await searchSimilarTurns(dataDir, query, 10);
    searchTimes.push(performance.now() - t0);
  }
  summarize(`lancedb searchSimilarTurns (top_k=10, ${count} rows, 20 runs)`, searchTimes);
}

async function main() {
  const scales = [1_000, 5_000, 10_000];
  for (const scale of scales) {
    console.log(`\n=== scale: ${scale} ===`);
    const tmpDir = mkdtempSync(join(tmpdir(), "traceback-bench-"));
    try {
      await benchSqlite(join(tmpDir, "traceback.db"), scale);
      await benchLanceDb(join(tmpDir, "lancedb"), scale);
    } finally {
      // Best-effort - see the matching comment in tests/unit/sqlite.test.ts
      // re: node:sqlite's WAL file handle lingering on Windows.
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
