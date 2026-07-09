import { execFileSync } from "node:child_process";
import {
  insertToolInvocation,
  queryFeedback,
  queryInvocations,
  type FeedbackRow,
  type ToolInvocationRow,
} from "../storage/sqlite.js";

// Baseline for line-reduction telemetry only - counts matches across the whole
// repo via `git grep -c <pattern>` (argv array, per the security rule in
// search.ts - never a string-interpolated shell command). This number is
// stored for telemetry but must never be included in any tool's returned
// `content` - the LLM never sees it, only get_efficiency_report's aggregate.
export function computeGrepBaseline(repoPath: string, pattern: string): number {
  try {
    const out = execFileSync("git", ["grep", "-c", "-e", pattern], { cwd: repoPath, encoding: "utf-8" });
    // `git grep -c` prints "path:count" per file; sum the counts.
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(":") + 1) || 0), 0);
  } catch (error) {
    const err = error as { status?: number };
    // Any failure (including exit status 1 = no matches anywhere) is a
    // legitimate "0" baseline - this is best-effort telemetry, never fatal
    // to the actual tool call it's measuring.
    void err;
    return 0;
  }
}

// Per-call extra metrics a tool handler can compute after it runs. All
// optional - tools that don't touch commits/sessions/lines just omit the
// fields they don't have.
export interface TelemetryExtras {
  gitDepthDays?: number;
  matchedRef?: string;
  deltaWindowScale?: number;
  warmLinesPulled?: number;
  baselineLines?: number; // when set alongside warmLinesPulled, globalLinesSkipped is derived
  mode?: string; // for fallback routing eval signal
  responseChars?: number;
  responseTokensEst?: number;
  baselineTokensEst?: number;
  layer4Skipped?: boolean;
  triggerScore?: number;
  triggerDecision?: "strong" | "weak" | "skip";
  triggerTermsCount?: number;
}

export interface ToolEfficiencyMetrics {
  tool_name: string;
  invocation_count: number;
  failure_count: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  warm_lines_total: number;
  baseline_lines_total: number;
  lines_saved_total: number;
  line_reduction_pct: number;
  avg_git_depth_days: number | null;
  avg_response_tokens_est: number | null;
  avg_baseline_tokens_est: number | null;
  token_reduction_pct: number | null;
  layer4_skipped_count: number;
  trigger_decision_counts: Record<string, number>;
}

export interface EfficiencyMetricsReport {
  total_invocations: number;
  filter: { since?: number; tool_name?: string };
  feedback_confirm_count: number;
  feedback_reject_count: number;
  tools: ToolEfficiencyMetrics[];
}

type ToolHandler<A, R> = (args: A) => Promise<R> | R;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function countFeedback(feedback: FeedbackRow[]): { confirm: number; reject: number } {
  let confirm = 0;
  let reject = 0;
  for (const row of feedback) {
    if (row.verdict === "confirm") confirm++;
    else if (row.verdict === "reject") reject++;
  }
  return { confirm, reject };
}

function buildToolMetrics(toolName: string, calls: ToolInvocationRow[]): ToolEfficiencyMetrics {
  const durations = calls.map((c) => c.duration_ms).sort((a, b) => a - b);
  const withReduction = calls.filter((c) => c.baseline_lines != null && c.warm_lines_pulled != null);
  const warmLinesTotal = withReduction.reduce((s, c) => s + (c.warm_lines_pulled ?? 0), 0);
  const baselineLinesTotal = withReduction.reduce((s, c) => s + (c.baseline_lines ?? 0), 0);
  const linesSavedTotal = withReduction.reduce((s, c) => s + (c.global_lines_skipped ?? 0), 0);
  const withDepth = calls.filter((c) => c.git_depth_days != null);
  const withTokens = calls.filter((c) => c.response_tokens_est != null);
  const withBaselineTokens = withTokens.filter((c) => c.baseline_tokens_est != null);
  const triggerDecisionCounts: Record<string, number> = {};
  let layer4SkippedCount = 0;
  for (const row of calls) {
    if (row.layer4_skipped === 1) layer4SkippedCount++;
    if (row.trigger_decision) {
      triggerDecisionCounts[row.trigger_decision] = (triggerDecisionCounts[row.trigger_decision] ?? 0) + 1;
    }
  }
  const avgResponseTokens =
    withTokens.length > 0
      ? withTokens.reduce((s, c) => s + (c.response_tokens_est ?? 0), 0) / withTokens.length
      : null;
  const avgBaselineTokens =
    withBaselineTokens.length > 0
      ? withBaselineTokens.reduce((s, c) => s + (c.baseline_tokens_est ?? 0), 0) / withBaselineTokens.length
      : null;
  return {
    tool_name: toolName,
    invocation_count: calls.length,
    failure_count: calls.filter((c) => c.ok === 0).length,
    avg_duration_ms: calls.reduce((s, c) => s + c.duration_ms, 0) / calls.length,
    p50_duration_ms: percentile(durations, 50),
    p95_duration_ms: percentile(durations, 95),
    warm_lines_total: warmLinesTotal,
    baseline_lines_total: baselineLinesTotal,
    lines_saved_total: linesSavedTotal,
    line_reduction_pct: baselineLinesTotal > 0 ? (100 * linesSavedTotal) / baselineLinesTotal : 0,
    avg_git_depth_days:
      withDepth.length > 0 ? withDepth.reduce((s, c) => s + (c.git_depth_days ?? 0), 0) / withDepth.length : null,
    avg_response_tokens_est: avgResponseTokens,
    avg_baseline_tokens_est: avgBaselineTokens,
    token_reduction_pct:
      avgBaselineTokens != null && avgBaselineTokens > 0 && avgResponseTokens != null
        ? (100 * Math.max(0, avgBaselineTokens - avgResponseTokens)) / avgBaselineTokens
        : null,
    layer4_skipped_count: layer4SkippedCount,
    trigger_decision_counts: triggerDecisionCounts,
  };
}

export function buildEfficiencyMetrics(
  sqlitePath: string,
  filter: { since?: number; toolName?: string },
): EfficiencyMetricsReport {
  const rows = queryInvocations(sqlitePath, filter);
  const feedback = queryFeedback(sqlitePath);
  const { confirm, reject } = countFeedback(feedback);
  const byTool = new Map<string, ToolInvocationRow[]>();
  for (const row of rows) {
    const list = byTool.get(row.tool_name) ?? [];
    list.push(row);
    byTool.set(row.tool_name, list);
  }
  const tools = Array.from(byTool.entries())
    .map(([toolName, calls]) => buildToolMetrics(toolName, calls))
    .sort((a, b) => a.tool_name.localeCompare(b.tool_name));
  return {
    total_invocations: rows.length,
    filter: {
      since: filter.since,
      tool_name: filter.toolName,
    },
    feedback_confirm_count: confirm,
    feedback_reject_count: reject,
    tools,
  };
}

// Single reusable wrapper applied uniformly to every server.registerTool
// handler in index.ts. `extract` is an optional per-tool callback run after
// the handler resolves, given the same args and the handler's result, to
// fill in tool-specific columns (temporal depth / delta window / line
// reduction) without copy-pasting timing/insert boilerplate into every tool.
export function withTelemetry<A, R>(
  sqlitePath: string,
  toolName: string,
  handler: ToolHandler<A, R>,
  extract?: (args: A, result: R) => TelemetryExtras | undefined,
): ToolHandler<A, R> {
  return async (args: A): Promise<R> => {
    const startedAt = Date.now();
    const t0 = performance.now();
    try {
      const result = await handler(args);
      const durationMs = performance.now() - t0;
      const extras = extract?.(args, result);
      const baseline = extras?.baselineLines;
      const warm = extras?.warmLinesPulled;
      insertToolInvocation(sqlitePath, {
        tool_name: toolName,
        mcp_method_name: "tools/call",
        input_args: JSON.stringify(args),
        started_at: startedAt,
        duration_ms: durationMs,
        ok: 1,
        error_message: null,
        git_depth_days: extras?.gitDepthDays ?? null,
        matched_ref: extras?.matchedRef ?? null,
        delta_window_scale: extras?.deltaWindowScale ?? null,
        warm_lines_pulled: warm ?? null,
        global_lines_skipped: baseline != null && warm != null ? Math.max(0, baseline - warm) : null,
        baseline_lines: baseline ?? null,
        search_mode: extras?.mode ?? null,
        response_chars: extras?.responseChars ?? null,
        response_tokens_est: extras?.responseTokensEst ?? null,
        baseline_tokens_est: extras?.baselineTokensEst ?? null,
        layer4_skipped: extras?.layer4Skipped == null ? null : extras.layer4Skipped ? 1 : 0,
        trigger_score: extras?.triggerScore ?? null,
        trigger_decision: extras?.triggerDecision ?? null,
        trigger_terms_count: extras?.triggerTermsCount ?? null,
      });
      return result;
    } catch (error) {
      const durationMs = performance.now() - t0;
      insertToolInvocation(sqlitePath, {
        tool_name: toolName,
        mcp_method_name: "tools/call",
        input_args: JSON.stringify(args),
        started_at: startedAt,
        duration_ms: durationMs,
        ok: 0,
        error_message: error instanceof Error ? error.message : String(error),
        git_depth_days: null,
        matched_ref: null,
        delta_window_scale: null,
        warm_lines_pulled: null,
        global_lines_skipped: null,
        baseline_lines: null,
        search_mode: null,
        response_chars: null,
        response_tokens_est: null,
        baseline_tokens_est: null,
        layer4_skipped: null,
        trigger_score: null,
        trigger_decision: null,
        trigger_terms_count: null,
      });
      throw error;
    }
  };
}

// Renders the telemetry aggregate as plain text - MCP tool results are just
// text content, mirroring how other tools JSON.stringify or plain-text their
// output rather than returning structured objects.
export function renderEfficiencyReport(sqlitePath: string, filter: { since?: number; toolName?: string }): string {
  const report = buildEfficiencyMetrics(sqlitePath, filter);
  if (report.total_invocations === 0) return "No telemetry recorded for the given filter.";

  const lines: string[] = [];
  lines.push(
    `Efficiency report (${report.total_invocations} calls${filter.since ? `, since ${new Date(filter.since).toISOString()}` : ""})`,
  );
  lines.push("");
  for (const tool of report.tools) {
    lines.push(
      `## ${tool.tool_name}  (${tool.invocation_count} calls, ${tool.failure_count} failed, avg ${tool.avg_duration_ms.toFixed(1)}ms)`,
    );
    if (tool.baseline_lines_total > 0) {
      lines.push(
        `   lines: ${tool.warm_lines_total} scanned vs ${tool.baseline_lines_total} baseline -> ${tool.line_reduction_pct.toFixed(1)}% reduction (${tool.lines_saved_total} lines saved)`,
      );
    }
    if (tool.avg_git_depth_days != null) {
      lines.push(`   avg git depth: ${tool.avg_git_depth_days.toFixed(1)} days`);
    }
    if (tool.avg_response_tokens_est != null) {
      if (tool.avg_baseline_tokens_est != null && tool.token_reduction_pct != null) {
        lines.push(
          `   tokens: avg ${tool.avg_response_tokens_est.toFixed(0)} returned vs ${tool.avg_baseline_tokens_est.toFixed(0)} baseline (${tool.token_reduction_pct.toFixed(1)}%)`,
        );
      } else {
        lines.push(`   tokens: avg ${tool.avg_response_tokens_est.toFixed(0)} returned`);
      }
    }
    if (tool.layer4_skipped_count > 0) {
      lines.push(`   layer4 skipped: ${tool.layer4_skipped_count}/${tool.invocation_count}`);
    }
    const triggerKeys = Object.keys(tool.trigger_decision_counts);
    if (triggerKeys.length > 0) {
      const distribution = triggerKeys
        .map((decision) => `${decision}:${tool.trigger_decision_counts[decision]}`)
        .join(", ");
      lines.push(`   trigger decisions: ${distribution}`);
    }
    lines.push("");
  }
  if (report.feedback_confirm_count > 0 || report.feedback_reject_count > 0) {
    lines.push(
      `Feedback: ${report.feedback_confirm_count} confirm, ${report.feedback_reject_count} reject`,
    );
    lines.push("");
  }
  return lines.join("\n");
}
