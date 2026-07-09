import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { createMetricsCollectorServer } from "../../src/metrics/collector-server.js";
import { buildPublicStats } from "../../src/metrics/public-stats.js";
import type { TelemetryRollupV1 } from "../../src/telemetry/schema.js";

let tmpDir: string;
let dbPath: string;
let server: http.Server;
let baseUrl = "";

const sampleRollup = (overrides: Partial<TelemetryRollupV1> = {}): TelemetryRollupV1 => ({
  schema_version: "1",
  install_id: "33333333-3333-4333-8333-333333333333",
  repo_hash: "abc123def4567890",
  traceback_version: "0.1.0-test",
  period_start: "2026-07-08",
  period_end: "2026-07-08",
  tool_name: "search_with_fallback",
  invocation_count: 4,
  failure_count: 1,
  duration_ms_p50: 12,
  duration_ms_p95: 40,
  lines_saved_total: 80,
  warm_lines_total: 20,
  baseline_lines_total: 100,
  feedback_confirm_count: 1,
  feedback_reject_count: 0,
  search_mode_counts: { cold_start_git_scoped: 4 },
  response_tokens_total: 100,
  baseline_tokens_total: 400,
  git_depth_days_avg: 14,
  git_depth_days_p50: 10,
  layer4_skipped_count: 1,
  layer4_total_count: 4,
  trigger_decision_counts: { weak: 3, strong: 1 },
  trigger_score_avg: 1.25,
  trigger_terms_count_avg: 2,
  delta_window_scale_avg: 2.5,
  ...overrides,
});

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-metrics-test-"));
  dbPath = join(tmpDir, "metrics-collector.db");
  server = createMetricsCollectorServer(dbPath);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("metrics collector", () => {
  it("accepts rollups and serves aggregated public stats", async () => {
    const response = await fetch(`${baseUrl}/v1/rollups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([sampleRollup()]),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accepted: number };
    expect(body.accepted).toBe(1);

    const statsResponse = await fetch(`${baseUrl}/api/public/stats`);
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as ReturnType<typeof buildPublicStats>;
    expect(stats.unique_installs).toBe(1);
    expect(stats.unique_repos).toBe(1);
    expect(stats.total_invocations).toBe(4);
    expect(stats.overall_line_reduction_pct).toBe(80);
    expect(stats.overall_token_reduction_pct).toBe(75);
    expect(stats.layer4_skipped_count).toBe(1);
    expect(stats.layer4_total_count).toBe(4);
    expect(stats.trigger_decision_counts.weak).toBe(3);
    expect(stats.tools[0].tool_name).toBe("search_with_fallback");
    expect(stats.tools[0].token_reduction_pct).toBe(75);
  });

  it("upserts duplicate rollups idempotently", async () => {
    const rollup = sampleRollup({ invocation_count: 2 });
    await fetch(`${baseUrl}/v1/rollups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([rollup]),
    });
    await fetch(`${baseUrl}/v1/rollups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([sampleRollup({ invocation_count: 9 })]),
    });
    const stats = buildPublicStats(dbPath);
    expect(stats.total_invocations).toBe(9);
  });

  it("rejects invalid payloads", async () => {
    const response = await fetch(`${baseUrl}/v1/rollups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ schema_version: "1", install_id: "not-a-uuid" }]),
    });
    expect(response.status).toBe(400);
  });

  it("serves public HTML page", async () => {
    await fetch(`${baseUrl}/v1/rollups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([sampleRollup()]),
    });
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("traceback Public Metrics");
    expect(html).toContain("search_with_fallback");
  });
});
