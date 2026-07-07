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
import { upsertTurnEmbeddings, searchSimilarTurns, upsertCommitEmbeddings, searchSimilarCommits } from "../dist/storage/lancedb.js";
import { embedText } from "../dist/embedding/embedder.js";

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Latency SLA thresholds for CI-gated regression detection.
// Conservative budgets to catch 2-3x performance regressions while allowing
// for OS variance and cold-start effects.
const SLA_BUDGETS = {
  "sqlite-insert": { p95: 20, p99: 50 }, // ms per insert
  "sqlite-query": { p95: 200, p99: 250 }, // ms per query scan (10k rows)
  "lancedb-search-1k": { p95: 100, p99: 150 }, // ms for 1k-row search
  "lancedb-search-5k": { p95: 150, p99: 200 }, // ms for 5k-row search
  "lancedb-search-10k": { p95: 150, p99: 200 }, // ms for 10k-row search
  "lancedb-search-cosine-1k": { p95: 100, p99: 150 },
  "commit-embeddings-search": { p95: 150, p99: 200 },
};

const violations = [];

function summarize(label, samplesMs, scale = null) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const avg = samplesMs.reduce((s, v) => s + v, 0) / samplesMs.length;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const max = sorted[sorted.length - 1];

  console.log(
    `${label}: n=${samplesMs.length} avg=${avg.toFixed(2)}ms p50=${p50.toFixed(2)}ms ` +
      `p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms max=${max.toFixed(2)}ms`,
  );

  // Check against SLA budgets
  const budgetKey = label.replace(/\s*\([^)]*\)/, "").toLowerCase().replace(/\s+/g, "-");
  const budget = SLA_BUDGETS[budgetKey];
  if (budget) {
    if (p95 > budget.p95) {
      violations.push({
        test: label,
        metric: "p95",
        actual: p95.toFixed(2),
        budget: budget.p95,
        exceeded: (p95 - budget.p95).toFixed(2),
      });
    }
    if (p99 > budget.p99) {
      violations.push({
        test: label,
        metric: "p99",
        actual: p99.toFixed(2),
        budget: budget.p99,
        exceeded: (p99 - budget.p99).toFixed(2),
      });
    }
  }
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
  summarize(`sqlite-insert (n=${count})`, insertTimes);

  const queryTimes = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    queryInvocations(dbPath, {});
    queryTimes.push(performance.now() - t0);
  }
  summarize(`sqlite-query (full table scan, ${count} rows, 20 runs)`, queryTimes);
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
    kind: "embedding_text",
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
  const scaleLabel = count === 1_000 ? "1k" : count === 5_000 ? "5k" : "10k";
  summarize(`lancedb-search-cosine-${scaleLabel} (top_k=10, ${count} rows, 20 runs)`, searchTimes);

  const commitRows = Array.from({ length: Math.min(count, 500) }, (_, i) => ({
    id: `bench-commit:${i}`,
    commit_sha: `sha-${i}`,
    session_id: "",
    repo_path: "/bench-repo",
    message: `bench commit message ${i}`,
    files_changed_summary: `file${i}.ts`,
    vector: baseVector.map((v, j) => v + (((i * 17 + j) % 5) - 2) * 1e-4),
    timestamp: Date.now(),
  }));
  await upsertCommitEmbeddings(dataDir, commitRows);
  const commitSearchTimes = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await searchSimilarCommits(dataDir, query, 5);
    commitSearchTimes.push(performance.now() - t0);
  }
  summarize(`commit-embeddings-search (${commitRows.length} rows, 10 runs)`, commitSearchTimes);
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

  // Report latency budget violations
  if (violations.length > 0) {
    console.error("\n🔴 LATENCY BUDGET VIOLATIONS (CI will fail):");
    console.error("═".repeat(80));
    for (const violation of violations) {
      console.error(
        `  ${violation.test}: ${violation.metric}=${violation.actual}ms (budget=${violation.budget}ms, exceeded by ${violation.exceeded}ms)`,
      );
    }
    console.error("═".repeat(80));
    console.error(`\n${violations.length} SLA violation(s) detected. Performance regression detected.`);
    process.exit(1);
  } else {
    console.log("\n✅ All latency budgets OK (no performance regressions detected)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
