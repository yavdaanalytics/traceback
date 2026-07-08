import type { FallbackResult } from "./fallback.js";
import { rankGrepHits, type GrepHit } from "./result-ranking.js";

export interface PayloadSummaryOptions {
  maxGrepLines?: number;
  maxCommitFiles?: number;
  omitEmptyRefinements?: boolean;
  compact?: boolean;
}

export function parseGrepLines(grepResult: string): GrepHit[] {
  const lines = grepResult.split("\n").filter(Boolean);
  const hits: GrepHit[] = [];
  for (const line of lines) {
    const first = line.indexOf(":");
    const second = first >= 0 ? line.indexOf(":", first + 1) : -1;
    if (first < 0 || second < 0) continue;
    const file = line.slice(0, first);
    const lineNum = Number(line.slice(first + 1, second));
    if (!file || Number.isNaN(lineNum)) continue;
    hits.push({ file, line: lineNum, content: line.slice(second + 1) });
  }
  return hits;
}

function isCommentOnly(content: string): boolean {
  return /^\s*(\/\/|#|\/\*|\*\/|\*\s)/.test(content);
}

export function summarizeFallbackForAgent(
  result: FallbackResult,
  opts: PayloadSummaryOptions = {},
): Record<string, unknown> {
  const maxGrepLines = opts.maxGrepLines ?? 40;
  const maxCommitFiles = opts.maxCommitFiles ?? 8;
  const omitEmptyRefinements = opts.omitEmptyRefinements ?? true;

  const parsed = result.ranked_hits ?? rankGrepHits(parseGrepLines(result.grep_result), {});
  const filtered = parsed.filter((hit) => !isCommentOnly(hit.content));
  const grepHits = filtered.slice(0, maxGrepLines);
  const filesTouched = Array.from(new Set(grepHits.map((hit) => hit.file)));

  const summary: Record<string, unknown> = {
    mode: result.mode,
    grep_summary: {
      hits_shown: grepHits.length,
      total_hits: filtered.length,
      total_hits_before_filter: parsed.length,
      files_touched: filesTouched,
    },
    grep_results: grepHits.map((hit) => ({
      file: hit.file,
      line: hit.line,
      snippet: hit.content.slice(0, 120),
    })),
    grep_result: grepHits.map((hit) => `${hit.file}:${hit.line}:${hit.content.slice(0, 120)}`).join("\n"),
    git_scope: {
      commits: (result.git_scope ?? []).slice(0, 5).map((commit) => ({
        hash: commit.commit_hash,
        message: commit.message ?? "",
        file_count: commit.files_changed.length,
        top_files: commit.files_changed.slice(0, maxCommitFiles),
        signals: commit.signals ?? [],
      })),
      hint: "Call get_commit_files(commit_sha) for full file list.",
    },
    layers: result.layers,
    source_labels: result.source_labels,
    source_label: result.source_label,
    layer4_skipped: result.layer4_skipped ?? false,
  };

  if (result.intent_summary && (result.intent_summary.sessions.length > 0 || result.intent_summary.intent_commits.length > 0)) {
    summary.intent_summary = {
      sessions: result.intent_summary.sessions.slice(0, 3),
      intent_commits: result.intent_summary.intent_commits.slice(0, 5),
      hint: "Call get_session_detail(session_id) for full transcript context.",
    };
  }

  if (result.relevant_patterns && result.relevant_patterns.length > 0) {
    summary.relevant_patterns = result.relevant_patterns.slice(0, 3);
  }
  if (result.trigger_diagnostics) {
    summary.trigger_diagnostics = {
      score: Number(result.trigger_diagnostics.score.toFixed(2)),
      decision: result.trigger_diagnostics.decision,
      terms_count: result.trigger_diagnostics.terms_count,
      matched_counts: {
        weak: result.trigger_diagnostics.matched.weak.length,
        debug: result.trigger_diagnostics.matched.debug.length,
        traceback: result.trigger_diagnostics.matched.traceback.length,
        negative: result.trigger_diagnostics.matched.negative.length,
      },
      matched_terms: {
        weak: result.trigger_diagnostics.matched.weak.slice(0, 3),
        debug: result.trigger_diagnostics.matched.debug.slice(0, 3),
        traceback: result.trigger_diagnostics.matched.traceback.slice(0, 3),
        negative: result.trigger_diagnostics.matched.negative.slice(0, 3),
      },
    };
  }

  if (omitEmptyRefinements) {
    if (result.refinements?.ast?.trim()) summary.ast_refinements = result.refinements.ast.trim().slice(0, 2000);
    if (result.refinements?.diff?.trim()) summary.diff_refinements = result.refinements.diff.trim().slice(0, 2000);
    if (result.refinements?.keyword?.trim()) summary.keyword_refinements = result.refinements.keyword.trim().slice(0, 2000);
  } else {
    summary.refinements = result.refinements ?? {};
  }

  return summary;
}

export function serializeForMCP(summary: Record<string, unknown>, compact = true): string {
  return JSON.stringify(summary, null, compact ? 0 : 2);
}

