import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTelemetry } from "../../src/mcp/telemetry.js";
import {
  disableTelemetry,
  enableTelemetry,
  readTelemetryConfig,
  writeTelemetryConfig,
} from "../../src/telemetry/config.js";
import { buildTelemetryRollups, hashRepoPath } from "../../src/telemetry/rollup.js";
import { TelemetryRollupV1Schema } from "../../src/telemetry/schema.js";

let tmpDir: string;
let dbPath: string;
let repoPath: string;
let configPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-rollup-test-"));
  dbPath = join(tmpDir, "traceback.db");
  repoPath = join(tmpDir, "repo");
  configPath = join(tmpDir, "telemetry.json");
  process.env.TRACEBACK_TELEMETRY_CONFIG_PATH = configPath;
});

afterEach(() => {
  delete process.env.TRACEBACK_TELEMETRY_CONFIG_PATH;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("telemetry config", () => {
  it("generates install_id and enables auto_upload when enabled", () => {
    expect(readTelemetryConfig().install_id).toBeNull();
    expect(readTelemetryConfig().auto_upload).toBe(false);
    const enabled = enableTelemetry("http://127.0.0.1:5566/v1/rollups");
    expect(enabled.opt_in).toBe(true);
    expect(enabled.auto_upload).toBe(true);
    expect(enabled.install_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    disableTelemetry();
    expect(readTelemetryConfig().opt_in).toBe(false);
    expect(readTelemetryConfig().auto_upload).toBe(false);
  });
});

describe("buildTelemetryRollups", () => {
  it("groups by day and tool without leaking input_args", async () => {
    const installId = "11111111-1111-4111-8111-111111111111";
    const day = "2026-07-08";
    const startedAt = Date.parse(`${day}T12:00:00.000Z`);

    const handler = withTelemetry(
      dbPath,
      "search_with_fallback",
      async (args: { query: string }) => ({ content: [{ type: "text", text: "ok" }] }),
      () => ({
        warmLinesPulled: 10,
        baselineLines: 100,
        mode: "cold_start_git_scoped",
        responseTokensEst: 40,
        baselineTokensEst: 200,
        gitDepthDays: 30,
        layer4Skipped: true,
        triggerScore: 1.5,
        triggerDecision: "weak" as const,
        triggerTermsCount: 2,
        deltaWindowScale: 3,
      }),
    );

    const originalNow = Date.now;
    Date.now = () => startedAt;
    try {
      await handler({ query: "secret user prompt should never upload" });
      await handler({ query: "another secret prompt" });
    } finally {
      Date.now = originalNow;
    }

    const rollups = buildTelemetryRollups({
      sqlitePath: dbPath,
      repoPath,
      installId,
      afterInvocationId: 0,
      tracebackVersion: "0.1.0-test",
    });

    expect(rollups).toHaveLength(1);
    const rollup = TelemetryRollupV1Schema.parse(rollups[0]);
    expect(rollup.tool_name).toBe("search_with_fallback");
    expect(rollup.invocation_count).toBe(2);
    expect(rollup.lines_saved_total).toBe(180);
    expect(rollup.search_mode_counts?.cold_start_git_scoped).toBe(2);
    expect(rollup.response_tokens_total).toBe(80);
    expect(rollup.baseline_tokens_total).toBe(400);
    expect(rollup.git_depth_days_avg).toBe(30);
    expect(rollup.git_depth_days_p50).toBe(30);
    expect(rollup.layer4_skipped_count).toBe(2);
    expect(rollup.layer4_total_count).toBe(2);
    expect(rollup.trigger_decision_counts?.weak).toBe(2);
    expect(rollup.trigger_score_avg).toBe(1.5);
    expect(rollup.trigger_terms_count_avg).toBe(2);
    expect(rollup.delta_window_scale_avg).toBe(3);
    expect(rollup.repo_hash).toBe(hashRepoPath(repoPath));
    expect(JSON.stringify(rollup)).not.toContain("secret");
    expect(JSON.stringify(rollup)).not.toContain("input_args");
  });

  it("respects incremental cursor via afterInvocationId", async () => {
    const installId = "22222222-2222-4222-8222-222222222222";
    const handler = withTelemetry(dbPath, "grep_codebase", async () => ({ content: [{ type: "text", text: "" }] }));
    await handler({});
    await handler({});

    const firstBatch = buildTelemetryRollups({
      sqlitePath: dbPath,
      repoPath,
      installId,
      afterInvocationId: 0,
    });
    expect(firstBatch[0].invocation_count).toBe(2);

    writeTelemetryConfig({
      ...readTelemetryConfig(),
      last_uploaded_invocation_id: 1,
    });

    const secondBatch = buildTelemetryRollups({
      sqlitePath: dbPath,
      repoPath,
      installId,
      afterInvocationId: readTelemetryConfig().last_uploaded_invocation_id,
    });
    expect(secondBatch).toHaveLength(1);
    expect(secondBatch[0].invocation_count).toBe(1);
  });
});
