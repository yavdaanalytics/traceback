import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { computeGrepBaseline, withTelemetry, renderEfficiencyReport, buildEfficiencyMetrics } from "../../src/mcp/telemetry.js";
import { insertFeedback, queryInvocations } from "../../src/storage/sqlite.js";

let dbPath: string;
let tmpDir: string;
let repoDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-telemetry-test-"));
  dbPath = join(tmpDir, "traceback.db");

  // A tiny real git repo for computeGrepBaseline to run `git grep -c` against.
  repoDir = join(tmpDir, "repo");
  mkdirSync(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repoDir });
  writeFileSync(join(repoDir, "a.ts"), "function jwtCheck() {}\nfunction jwtCheck2() {}\n");
  writeFileSync(join(repoDir, "b.ts"), "const jwtCheck = 1;\n");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  // --no-verify: this is a throwaway fixture repo, not the real one - skip
  // any globally-configured commit hooks that assume a non-empty history.
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });
});

afterAll(() => {
  // Best-effort - see the matching comment in tests/unit/sqlite.test.ts.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("computeGrepBaseline", () => {
  it("sums per-file match counts across the repo", () => {
    expect(computeGrepBaseline(repoDir, "jwtCheck")).toBe(3);
  });

  it("returns 0 for a pattern with no matches (git grep exit 1), not an error", () => {
    expect(computeGrepBaseline(repoDir, "definitely_not_present_xyz")).toBe(0);
  });

  it("returns 0 (not throws) for a path that isn't a git repo at all", () => {
    const notARepo = join(tmpDir, "not-a-repo");
    mkdirSync(notARepo);
    expect(() => computeGrepBaseline(notARepo, "anything")).not.toThrow();
    expect(computeGrepBaseline(notARepo, "anything")).toBe(0);
  });
});

describe("withTelemetry", () => {
  it("logs a successful call with extractor-derived extras", async () => {
    const handler = withTelemetry(
      dbPath,
      "test_tool_ok",
      async (args: { q: string }) => ({ content: [{ type: "text", text: "3 lines\nof\noutput" }] }),
      (_args, result) => ({
        deltaWindowScale: 2,
        warmLinesPulled: (result.content[0].text as string).split("\n").length,
        baselineLines: 100,
      }),
    );
    await handler({ q: "hello" });
    const rows = queryInvocations(dbPath, { toolName: "test_tool_ok" });
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(1);
    expect(rows[0].delta_window_scale).toBe(2);
    expect(rows[0].warm_lines_pulled).toBe(3);
    expect(rows[0].baseline_lines).toBe(100);
    expect(rows[0].global_lines_skipped).toBe(97);
    expect(JSON.parse(rows[0].input_args)).toEqual({ q: "hello" });
  });

  it("clamps global_lines_skipped at 0 when warm lines exceed the baseline", async () => {
    const handler = withTelemetry(
      dbPath,
      "test_tool_over_baseline",
      async () => ({ content: [{ type: "text", text: "x\ny\nz" }] }),
      (_a, result) => ({ warmLinesPulled: 3, baselineLines: 1 }),
    );
    await handler({});
    const rows = queryInvocations(dbPath, { toolName: "test_tool_over_baseline" });
    expect(rows[0].global_lines_skipped).toBe(0);
  });

  it("logs a failed call with ok=0 and the error message, then rethrows", async () => {
    const handler = withTelemetry(dbPath, "test_tool_fail", async () => {
      throw new Error("boom");
    });
    await expect(handler({})).rejects.toThrow("boom");
    const rows = queryInvocations(dbPath, { toolName: "test_tool_fail" });
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(0);
    expect(rows[0].error_message).toBe("boom");
  });

  it("does not call extract when the handler throws", async () => {
    let extractCalled = false;
    const handler = withTelemetry(
      dbPath,
      "test_tool_fail_extract",
      async () => {
        throw new Error("nope");
      },
      () => {
        extractCalled = true;
        return undefined;
      },
    );
    await expect(handler({})).rejects.toThrow();
    expect(extractCalled).toBe(false);
  });

  it("still logs a row when extract itself returns undefined", async () => {
    const handler = withTelemetry(
      dbPath,
      "test_tool_no_extras",
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      () => undefined,
    );
    await handler({});
    const rows = queryInvocations(dbPath, { toolName: "test_tool_no_extras" });
    expect(rows[0].delta_window_scale).toBeNull();
    expect(rows[0].warm_lines_pulled).toBeNull();
  });

  it("records trigger routing metrics when provided by extractor", async () => {
    const handler = withTelemetry(
      dbPath,
      "test_tool_trigger",
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      () => ({ triggerScore: 2.4, triggerDecision: "strong", triggerTermsCount: 3 }),
    );
    await handler({});
    const rows = queryInvocations(dbPath, { toolName: "test_tool_trigger" });
    expect(rows[0].trigger_score).toBe(2.4);
    expect(rows[0].trigger_decision).toBe("strong");
    expect(rows[0].trigger_terms_count).toBe(3);
  });
});

describe("renderEfficiencyReport", () => {
  it("reports 'no telemetry' for an empty filter match", () => {
    expect(renderEfficiencyReport(dbPath, { toolName: "tool_with_zero_calls" })).toBe(
      "No telemetry recorded for the given filter.",
    );
  });

  it("groups by tool and computes call count, avg latency, failures, and line-reduction %", async () => {
    const handler = withTelemetry(
      dbPath,
      "report_tool",
      async () => ({ content: [{ type: "text", text: "a\nb" }] }),
      () => ({ warmLinesPulled: 2, baselineLines: 200 }),
    );
    await handler({});
    await handler({});
    const text = renderEfficiencyReport(dbPath, { toolName: "report_tool" });
    expect(text).toContain("report_tool");
    expect(text).toContain("2 calls, 0 failed");
    // 4 lines scanned vs 400 baseline -> 99% reduction
    expect(text).toContain("4 scanned vs 400 baseline");
    expect(text).toMatch(/99\.0% reduction/);
  });

  it("includes avg git depth only for tools that recorded it", async () => {
    const handler = withTelemetry(
      dbPath,
      "depth_tool",
      async () => ({ content: [{ type: "text", text: "" }] }),
      () => ({ gitDepthDays: 10 }),
    );
    await handler({});
    const text = renderEfficiencyReport(dbPath, { toolName: "depth_tool" });
    expect(text).toContain("avg git depth: 10.0 days");
  });

  it("shows trigger decision distribution when available", async () => {
    const handler = withTelemetry(
      dbPath,
      "trigger_dist_tool",
      async () => ({ content: [{ type: "text", text: "" }] }),
      () => ({ triggerDecision: "weak" }),
    );
    await handler({});
    await handler({});
    const text = renderEfficiencyReport(dbPath, { toolName: "trigger_dist_tool" });
    expect(text).toContain("trigger decisions: weak:2");
  });
});

describe("buildEfficiencyMetrics", () => {
  it("returns empty tools for no matching invocations", () => {
    const report = buildEfficiencyMetrics(dbPath, { toolName: "missing_tool_xyz" });
    expect(report.total_invocations).toBe(0);
    expect(report.tools).toEqual([]);
  });

  it("computes percentiles and feedback counts", async () => {
    const handler = withTelemetry(
      dbPath,
      "metrics_tool",
      async () => ({ content: [{ type: "text", text: "a\nb\nc" }] }),
      () => ({ warmLinesPulled: 3, baselineLines: 30, triggerDecision: "strong" }),
    );
    await handler({});
    await handler({});
    insertFeedback(dbPath, {
      invocation_id: queryInvocations(dbPath, { toolName: "metrics_tool" })[0].invocation_id,
      session_id: null,
      verdict: "confirm",
      note: null,
      created_at: Date.now(),
    });
    insertFeedback(dbPath, {
      invocation_id: null,
      session_id: "sess-1",
      verdict: "reject",
      note: null,
      created_at: Date.now(),
    });

    const report = buildEfficiencyMetrics(dbPath, { toolName: "metrics_tool" });
    expect(report.total_invocations).toBe(2);
    expect(report.feedback_confirm_count).toBeGreaterThanOrEqual(1);
    expect(report.feedback_reject_count).toBeGreaterThanOrEqual(1);
    const tool = report.tools[0];
    expect(tool.tool_name).toBe("metrics_tool");
    expect(tool.p50_duration_ms).toBeGreaterThanOrEqual(0);
    expect(tool.p95_duration_ms).toBeGreaterThanOrEqual(tool.p50_duration_ms);
    expect(tool.lines_saved_total).toBe(54);
    expect(tool.line_reduction_pct).toBe(90);
    expect(tool.trigger_decision_counts.strong).toBe(2);
  });

  it("computes token_reduction_pct as reduced percentage, not remaining percentage", async () => {
    const handler = withTelemetry(
      dbPath,
      "token_metrics_tool",
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      () => ({
        responseTokensEst: 100,
        baselineTokensEst: 400,
      }),
    );
    await handler({});

    const report = buildEfficiencyMetrics(dbPath, { toolName: "token_metrics_tool" });
    expect(report.total_invocations).toBe(1);
    const tool = report.tools[0];
    expect(tool.avg_response_tokens_est).toBe(100);
    expect(tool.avg_baseline_tokens_est).toBe(400);
    // 400 baseline vs 100 response => 75% reduction.
    expect(tool.token_reduction_pct).toBe(75);
  });
});
