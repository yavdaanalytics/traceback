import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  maxInvocationId,
  queryFeedback,
  queryInvocations,
  type ToolInvocationRow,
} from "../storage/sqlite.js";
import { normalizePath } from "../util/paths.js";
import { tracebackVersion } from "../version.js";
import type { TelemetryRollupV1 } from "./schema.js";

export function hashRepoPath(repoPath: string): string {
  return createHash("sha256").update(normalizePath(resolve(repoPath))).digest("hex").slice(0, 16);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface RollupBucket {
  period_start: string;
  tool_name: string;
  rows: ToolInvocationRow[];
}

function groupInvocations(rows: ToolInvocationRow[]): RollupBucket[] {
  const buckets = new Map<string, RollupBucket>();
  for (const row of rows) {
    const day = utcDayKey(row.started_at);
    const key = `${day}\0${row.tool_name}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      buckets.set(key, { period_start: day, tool_name: row.tool_name, rows: [row] });
    }
  }
  return Array.from(buckets.values());
}

function countSearchModes(rows: ToolInvocationRow[]): Record<string, number> | undefined {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.search_mode) continue;
    counts[row.search_mode] = (counts[row.search_mode] ?? 0) + 1;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function countTriggerDecisions(rows: ToolInvocationRow[]): Record<string, number> | undefined {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.trigger_decision) continue;
    counts[row.trigger_decision] = (counts[row.trigger_decision] ?? 0) + 1;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function avgOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function extendedAggregates(rows: ToolInvocationRow[]): Partial<TelemetryRollupV1> {
  const responseTokens = rows
    .map((r) => r.response_tokens_est)
    .filter((v): v is number => v != null);
  const baselineTokens = rows
    .map((r) => r.baseline_tokens_est)
    .filter((v): v is number => v != null);
  const gitDepths = rows
    .map((r) => r.git_depth_days)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const layer4Known = rows.filter((r) => r.layer4_skipped != null);
  const triggerScores = rows
    .map((r) => r.trigger_score)
    .filter((v): v is number => v != null);
  const triggerTerms = rows
    .map((r) => r.trigger_terms_count)
    .filter((v): v is number => v != null);
  const deltaScales = rows
    .map((r) => r.delta_window_scale)
    .filter((v): v is number => v != null);

  const out: Partial<TelemetryRollupV1> = {};
  if (responseTokens.length > 0) {
    out.response_tokens_total = responseTokens.reduce((s, v) => s + v, 0);
  }
  if (baselineTokens.length > 0) {
    out.baseline_tokens_total = baselineTokens.reduce((s, v) => s + v, 0);
  }
  const gitAvg = avgOf(gitDepths);
  if (gitAvg != null) {
    out.git_depth_days_avg = gitAvg;
    out.git_depth_days_p50 = percentile(gitDepths, 50);
  }
  if (layer4Known.length > 0) {
    out.layer4_total_count = layer4Known.length;
    out.layer4_skipped_count = layer4Known.filter((r) => r.layer4_skipped === 1).length;
  }
  const triggerCounts = countTriggerDecisions(rows);
  if (triggerCounts) out.trigger_decision_counts = triggerCounts;
  const scoreAvg = avgOf(triggerScores);
  if (scoreAvg != null) out.trigger_score_avg = scoreAvg;
  const termsAvg = avgOf(triggerTerms);
  if (termsAvg != null) out.trigger_terms_count_avg = termsAvg;
  const deltaAvg = avgOf(deltaScales);
  if (deltaAvg != null) out.delta_window_scale_avg = deltaAvg;
  return out;
}

function feedbackCountsForPeriod(
  sqlitePath: string,
  periodStart: string,
  periodEndExclusiveMs: number,
): { confirm: number; reject: number } {
  const periodStartMs = Date.parse(`${periodStart}T00:00:00.000Z`);
  const feedback = queryFeedback(sqlitePath);
  let confirm = 0;
  let reject = 0;
  for (const row of feedback) {
    if (row.created_at < periodStartMs || row.created_at >= periodEndExclusiveMs) continue;
    if (row.verdict === "confirm") confirm++;
    else if (row.verdict === "reject") reject++;
  }
  return { confirm, reject };
}

export function buildTelemetryRollups(opts: {
  sqlitePath: string;
  repoPath: string;
  installId: string;
  afterInvocationId?: number;
  tracebackVersion?: string;
}): TelemetryRollupV1[] {
  const rows = queryInvocations(opts.sqlitePath, {
    afterInvocationId: opts.afterInvocationId ?? 0,
  });
  if (rows.length === 0) return [];

  const repoHash = hashRepoPath(opts.repoPath);
  const version = opts.tracebackVersion ?? tracebackVersion();
  const rollups: TelemetryRollupV1[] = [];

  for (const bucket of groupInvocations(rows)) {
    const durations = bucket.rows.map((r) => r.duration_ms).sort((a, b) => a - b);
    const withReduction = bucket.rows.filter((r) => r.baseline_lines != null && r.warm_lines_pulled != null);
    const periodEndMs = Date.parse(`${bucket.period_start}T00:00:00.000Z`) + 86_400_000;
    const feedback = feedbackCountsForPeriod(opts.sqlitePath, bucket.period_start, periodEndMs);
    rollups.push({
      schema_version: "1",
      install_id: opts.installId,
      repo_hash: repoHash,
      traceback_version: version,
      period_start: bucket.period_start,
      period_end: bucket.period_start,
      tool_name: bucket.tool_name,
      invocation_count: bucket.rows.length,
      failure_count: bucket.rows.filter((r) => r.ok === 0).length,
      duration_ms_p50: percentile(durations, 50),
      duration_ms_p95: percentile(durations, 95),
      lines_saved_total: withReduction.reduce((s, r) => s + (r.global_lines_skipped ?? 0), 0),
      warm_lines_total: withReduction.reduce((s, r) => s + (r.warm_lines_pulled ?? 0), 0),
      baseline_lines_total: withReduction.reduce((s, r) => s + (r.baseline_lines ?? 0), 0),
      feedback_confirm_count: feedback.confirm,
      feedback_reject_count: feedback.reject,
      search_mode_counts: countSearchModes(bucket.rows),
      ...extendedAggregates(bucket.rows),
    });
  }

  return rollups.sort((a, b) =>
    a.period_start === b.period_start
      ? a.tool_name.localeCompare(b.tool_name)
      : a.period_start.localeCompare(b.period_start),
  );
}

export function maxInvocationIdForRepo(sqlitePath: string): number {
  return maxInvocationId(sqlitePath);
}
