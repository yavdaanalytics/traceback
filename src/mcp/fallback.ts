import { deriveSearchTerms, gitHistoryScope, type GitHistoryScopeResult } from "../git/history-scope.js";
import { searchGrep } from "./search.js";
import { findSimilarSessions, type Config, type SessionSearchResult } from "./recall.js";
import { getFilesForCommit, getLinksForSession } from "../storage/sqlite.js";

// Default confidence threshold for session-vector matches. Lower values = accept lower-confidence
// semantic matches; higher values = only accept very strong matches, falling back to git history.
// This is an empirically-tunable eval signal: monitor which modes fire most often and adjust.
export const DEFAULT_CONFIDENCE_THRESHOLD = 2.0;

export interface FallbackOptions {
  query: string;
  pattern?: string;
  project_path?: string;
}

export interface FallbackResult {
  mode: "scoped_session" | "scope_miss_widened_to_git_history" | "scope_miss_widened_to_full_repo" |
        "cold_start_git_scoped" | "cold_start_full_repo";
  grep_result: string;
  session_matches?: Array<{ session_id: string; _distance: number }>;
  git_scope?: GitHistoryScopeResult[];
  source_label: string;
}

// Orchestration tool: chain session-vector search → grep → git-history widening → full-repo grep.
// The `mode` field is the eval signal for tuning confidence threshold; every call's mode is
// logged via telemetry for analysis.
export async function searchWithFallback(config: Config, opts: FallbackOptions): Promise<FallbackResult> {
  const derivePattern = (q: string): string => {
    const terms = deriveSearchTerms(q);
    if (terms.length === 0) return q; // Fallback: use query as-is
    return terms.map((t) => `(${t})`).join("|"); // Build naive alternation regex
  };

  const pattern = opts.pattern ?? derivePattern(opts.query);

  // Phase 1: try session-vector search
  const sessionHits = await findSimilarSessions(config, opts.query, 5, opts.project_path);

  if (sessionHits.length > 0 && sessionHits[0]._distance <= config.confidenceThreshold) {
    // High-confidence session match: extract scope from linked commits
    const scope = new Set<string>();
    for (const hit of sessionHits) {
      const sessionId = String(hit.session_id);
      const links = getLinksForSession(config.sqlitePath, sessionId);
      for (const link of links) {
        const files = getFilesForCommit(config.sqlitePath, link.sha);
        files.forEach((f) => scope.add(f));
      }
    }

    // Try scoped grep first
    if (scope.size > 0) {
      const grepResult = searchGrep(config.repoPath, pattern, Array.from(scope));
      if (grepResult.trim().length > 0) {
        return {
          mode: "scoped_session",
          grep_result: grepResult,
          session_matches: sessionHits.map(({ session_id, _distance }) => ({ session_id: String(session_id), _distance })),
          source_label: "session match (probabilistic, outcome-aware)",
        };
      }
    }

    // Session scope hit but grep came up empty; widen to git history
    const terms = deriveSearchTerms(opts.query);
    const gitScope = gitHistoryScope(config.repoPath, terms);
    if (gitScope.length > 0) {
      const gitFiles = gitScope.flatMap((c) => c.files_changed);
      const widened = searchGrep(config.repoPath, pattern, gitFiles);
      if (widened.trim().length > 0) {
        return {
          mode: "scope_miss_widened_to_git_history",
          grep_result: widened,
          session_matches: sessionHits.map(({ session_id, _distance }) => ({ session_id: String(session_id), _distance })),
          git_scope: gitScope,
          source_label: "git history match (deterministic commit search, outcome-unaware)",
        };
      }
    }

    // Both scopes exhausted; fall back to full-repo grep
    const fullResult = searchGrep(config.repoPath, pattern, []);
    return {
      mode: "scope_miss_widened_to_full_repo",
      grep_result: fullResult,
      session_matches: sessionHits.map(({ session_id, _distance }) => ({ session_id: String(session_id), _distance })),
      source_label: "exact grep match (deterministic, no scoping)",
    };
  }

  // Low confidence or no session matches: cold-start path via git history
  const terms = deriveSearchTerms(opts.query);
  const gitScope = gitHistoryScope(config.repoPath, terms);
  if (gitScope.length > 0) {
    const gitFiles = gitScope.flatMap((c) => c.files_changed);
    const scoped = searchGrep(config.repoPath, pattern, gitFiles);
    if (scoped.trim().length > 0) {
      return {
        mode: "cold_start_git_scoped",
        grep_result: scoped,
        git_scope: gitScope,
        source_label: "git history match (deterministic commit search, outcome-unaware)",
      };
    }
  }

  // No git history match either; full-repo grep
  const fullResult = searchGrep(config.repoPath, pattern, []);
  return {
    mode: "cold_start_full_repo",
    grep_result: fullResult,
    source_label: "exact grep match (deterministic, no scoping)",
  };
}
