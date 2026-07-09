import { listCollectorRollups, type CollectorRollupRow } from "./collector-db.js";

export interface PublicToolStats {
  tool_name: string;
  invocation_count: number;
  failure_count: number;
  lines_saved_total: number;
  baseline_lines_total: number;
  line_reduction_pct: number;
  avg_duration_ms_p50: number;
  avg_duration_ms_p95: number;
  response_tokens_total: number;
  baseline_tokens_total: number;
  token_reduction_pct: number;
  layer4_skipped_count: number;
  layer4_total_count: number;
}

export interface PublicStatsReport {
  unique_installs: number;
  unique_repos: number;
  total_invocations: number;
  total_failures: number;
  total_lines_saved: number;
  total_baseline_lines: number;
  overall_line_reduction_pct: number;
  total_response_tokens: number;
  total_baseline_tokens: number;
  overall_token_reduction_pct: number;
  layer4_skipped_count: number;
  layer4_total_count: number;
  layer4_skip_pct: number;
  trigger_decision_counts: Record<string, number>;
  versions: Record<string, number>;
  tools: PublicToolStats[];
  updated_at: string;
}

function sumNullable(rows: CollectorRollupRow[], pick: (r: CollectorRollupRow) => number | null): number {
  return rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
}

function mergeTriggerCounts(rows: CollectorRollupRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (!row.trigger_decision_counts_json) continue;
    try {
      const parsed = JSON.parse(row.trigger_decision_counts_json) as Record<string, number>;
      for (const [key, value] of Object.entries(parsed)) {
        out[key] = (out[key] ?? 0) + value;
      }
    } catch {
      // ignore malformed JSON from older/manual rows
    }
  }
  return out;
}

function aggregateTools(rows: CollectorRollupRow[]): PublicToolStats[] {
  const byTool = new Map<string, CollectorRollupRow[]>();
  for (const row of rows) {
    const list = byTool.get(row.tool_name) ?? [];
    list.push(row);
    byTool.set(row.tool_name, list);
  }
  return Array.from(byTool.entries())
    .map(([toolName, toolRows]) => {
      const invocations = toolRows.reduce((s, r) => s + r.invocation_count, 0);
      const failures = toolRows.reduce((s, r) => s + r.failure_count, 0);
      const linesSaved = toolRows.reduce((s, r) => s + r.lines_saved_total, 0);
      const baseline = toolRows.reduce((s, r) => s + r.baseline_lines_total, 0);
      const p50Sum = toolRows.reduce((s, r) => s + r.duration_ms_p50 * r.invocation_count, 0);
      const p95Sum = toolRows.reduce((s, r) => s + r.duration_ms_p95 * r.invocation_count, 0);
      const responseTokens = sumNullable(toolRows, (r) => r.response_tokens_total);
      const baselineTokens = sumNullable(toolRows, (r) => r.baseline_tokens_total);
      const layer4Skipped = sumNullable(toolRows, (r) => r.layer4_skipped_count);
      const layer4Total = sumNullable(toolRows, (r) => r.layer4_total_count);
      return {
        tool_name: toolName,
        invocation_count: invocations,
        failure_count: failures,
        lines_saved_total: linesSaved,
        baseline_lines_total: baseline,
        line_reduction_pct: baseline > 0 ? (100 * linesSaved) / baseline : 0,
        avg_duration_ms_p50: invocations > 0 ? p50Sum / invocations : 0,
        avg_duration_ms_p95: invocations > 0 ? p95Sum / invocations : 0,
        response_tokens_total: responseTokens,
        baseline_tokens_total: baselineTokens,
        token_reduction_pct:
          baselineTokens > 0 ? (100 * Math.max(0, baselineTokens - responseTokens)) / baselineTokens : 0,
        layer4_skipped_count: layer4Skipped,
        layer4_total_count: layer4Total,
      };
    })
    .sort((a, b) => b.invocation_count - a.invocation_count);
}

export function buildPublicStats(dbPath: string): PublicStatsReport {
  const rows = listCollectorRollups(dbPath);
  const installs = new Set(rows.map((r) => r.install_id));
  const repos = new Set(rows.map((r) => r.repo_hash));
  const versions: Record<string, number> = {};
  for (const row of rows) {
    versions[row.traceback_version] = (versions[row.traceback_version] ?? 0) + row.invocation_count;
  }
  const totalInvocations = rows.reduce((s, r) => s + r.invocation_count, 0);
  const totalFailures = rows.reduce((s, r) => s + r.failure_count, 0);
  const totalLinesSaved = rows.reduce((s, r) => s + r.lines_saved_total, 0);
  const totalBaseline = rows.reduce((s, r) => s + r.baseline_lines_total, 0);
  const totalResponseTokens = sumNullable(rows, (r) => r.response_tokens_total);
  const totalBaselineTokens = sumNullable(rows, (r) => r.baseline_tokens_total);
  const layer4Skipped = sumNullable(rows, (r) => r.layer4_skipped_count);
  const layer4Total = sumNullable(rows, (r) => r.layer4_total_count);
  return {
    unique_installs: installs.size,
    unique_repos: repos.size,
    total_invocations: totalInvocations,
    total_failures: totalFailures,
    total_lines_saved: totalLinesSaved,
    total_baseline_lines: totalBaseline,
    overall_line_reduction_pct: totalBaseline > 0 ? (100 * totalLinesSaved) / totalBaseline : 0,
    total_response_tokens: totalResponseTokens,
    total_baseline_tokens: totalBaselineTokens,
    overall_token_reduction_pct:
      totalBaselineTokens > 0
        ? (100 * Math.max(0, totalBaselineTokens - totalResponseTokens)) / totalBaselineTokens
        : 0,
    layer4_skipped_count: layer4Skipped,
    layer4_total_count: layer4Total,
    layer4_skip_pct: layer4Total > 0 ? (100 * layer4Skipped) / layer4Total : 0,
    trigger_decision_counts: mergeTriggerCounts(rows),
    versions,
    tools: aggregateTools(rows),
    updated_at: new Date().toISOString(),
  };
}
