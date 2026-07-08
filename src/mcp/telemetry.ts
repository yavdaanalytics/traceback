import { execFileSync } from "node:child_process";
import { insertToolInvocation, queryInvocations, type ToolInvocationRow } from "../storage/sqlite.js";

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

type ToolHandler<A, R> = (args: A) => Promise<R> | R;

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
  const rows = queryInvocations(sqlitePath, filter);
  if (rows.length === 0) return "No telemetry recorded for the given filter.";

  const byTool = new Map<string, ToolInvocationRow[]>();
  for (const r of rows) {
    const list = byTool.get(r.tool_name) ?? [];
    list.push(r);
    byTool.set(r.tool_name, list);
  }

  const lines: string[] = [];
  lines.push(
    `Efficiency report (${rows.length} calls${filter.since ? `, since ${new Date(filter.since).toISOString()}` : ""})`,
  );
  lines.push("");
  for (const [tool, calls] of byTool) {
    const withReduction = calls.filter((c) => c.baseline_lines != null && c.warm_lines_pulled != null);
    const avgDuration = calls.reduce((s, c) => s + c.duration_ms, 0) / calls.length;
    const failCount = calls.filter((c) => c.ok === 0).length;
    lines.push(`## ${tool}  (${calls.length} calls, ${failCount} failed, avg ${avgDuration.toFixed(1)}ms)`);
    if (withReduction.length > 0) {
      const totalBaseline = withReduction.reduce((s, c) => s + (c.baseline_lines ?? 0), 0);
      const totalWarm = withReduction.reduce((s, c) => s + (c.warm_lines_pulled ?? 0), 0);
      const totalSkipped = withReduction.reduce((s, c) => s + (c.global_lines_skipped ?? 0), 0);
      const pct = totalBaseline > 0 ? (100 * totalSkipped) / totalBaseline : 0;
      lines.push(
        `   lines: ${totalWarm} scanned vs ${totalBaseline} baseline -> ${pct.toFixed(1)}% reduction (${totalSkipped} lines saved)`,
      );
    }
    const withDepth = calls.filter((c) => c.git_depth_days != null);
    if (withDepth.length > 0) {
      const avgDepth = withDepth.reduce((s, c) => s + (c.git_depth_days ?? 0), 0) / withDepth.length;
      lines.push(`   avg git depth: ${avgDepth.toFixed(1)} days`);
    }
    const withTokens = calls.filter((c) => c.response_tokens_est != null);
    if (withTokens.length > 0) {
      const avgReturned = withTokens.reduce((s, c) => s + (c.response_tokens_est ?? 0), 0) / withTokens.length;
      const baselineRows = withTokens.filter((c) => c.baseline_tokens_est != null);
      if (baselineRows.length > 0) {
        const avgBaseline = baselineRows.reduce((s, c) => s + (c.baseline_tokens_est ?? 0), 0) / baselineRows.length;
        const pct = avgBaseline > 0 ? (100 * avgReturned) / avgBaseline : 0;
        lines.push(
          `   tokens: avg ${avgReturned.toFixed(0)} returned vs ${avgBaseline.toFixed(0)} baseline (${pct.toFixed(1)}%)`,
        );
      } else {
        lines.push(`   tokens: avg ${avgReturned.toFixed(0)} returned`);
      }
    }
    const withL4 = calls.filter((c) => c.layer4_skipped != null);
    if (withL4.length > 0) {
      const skipped = withL4.filter((c) => c.layer4_skipped === 1).length;
      lines.push(`   layer4 skipped: ${skipped}/${withL4.length}`);
    }
    const withTrigger = calls.filter((c) => c.trigger_decision != null);
    if (withTrigger.length > 0) {
      const byDecision = new Map<string, number>();
      for (const row of withTrigger) {
        const key = row.trigger_decision ?? "unknown";
        byDecision.set(key, (byDecision.get(key) ?? 0) + 1);
      }
      const distribution = Array.from(byDecision.entries())
        .map(([decision, count]) => `${decision}:${count}`)
        .join(", ");
      lines.push(`   trigger decisions: ${distribution}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
