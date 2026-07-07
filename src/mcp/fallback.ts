import { deriveSearchTerms, gitHistoryScope, enrichGitScopeWithIntent } from "../git/history-scope.js";
import { kickOffCommitEmbeddingIndex } from "../git/commit-embedder.js";
import { searchGrep } from "./search.js";
import { findSimilarSessions, type Config, type SessionSearchResult } from "./recall.js";
import { getFilesForCommit, getLinksForSession } from "../storage/sqlite.js";
import { astSymbolSearch } from "../ast/symbol-search.js";
import { diffSearch, keywordSearch } from "./code-search.js";
import type { ResponseMeta, SourceLabel } from "./labels.js";

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.35;

export type FallbackMode =
  | "scoped_session"
  | "git_history_intent"
  | "grep_scoped"
  | "grep_full_repo"
  | "ast_refined"
  | "diff_refined"
  | "keyword_refined"
  | "silent_miss_scoped"
  | "scope_miss_widened_to_git_history"
  | "scope_miss_widened_to_full_repo"
  | "cold_start_git_scoped"
  | "cold_start_full_repo";

export interface FallbackLayer {
  layer: 1 | 2 | 3 | 4;
  tool: string;
  certainty: ResponseMeta["certainty"];
  mode: FallbackMode;
  hit_count?: number;
}

export interface FallbackOptions {
  query: string;
  pattern?: string;
  project_path?: string;
}

export interface FallbackResult {
  mode: FallbackMode;
  grep_result: string;
  layers: FallbackLayer[];
  session_matches?: Array<{ session_id: string; _distance: number }>;
  git_scope?: Array<{ commit_hash: string; files_changed: string[]; signals?: string[] }>;
  refinements?: { ast?: string; diff?: string; keyword?: string };
  source_labels: string[];
  source_label: string;
}

export async function searchWithFallback(config: Config, opts: FallbackOptions): Promise<FallbackResult> {
  kickOffCommitEmbeddingIndex(config.dataDir, config.sqlitePath, config.repoPath);

  const derivePattern = (q: string): string => {
    const terms = deriveSearchTerms(q);
    if (terms.length === 0) return q;
    return terms.map((t) => `(${t})`).join("|");
  };

  const pattern = opts.pattern ?? derivePattern(opts.query);
  const layers: FallbackLayer[] = [];
  const sourceLabels: string[] = [];

  // L1: session cosine
  const sessionHits = await findSimilarSessions(config, opts.query, 5, opts.project_path);
  const highConfidence =
    sessionHits.length > 0 && sessionHits[0]._distance <= config.confidenceThreshold;

  if (sessionHits.length > 0) {
    layers.push({
      layer: 1,
      tool: "find_similar_sessions",
      certainty: "probabilistic",
      mode: highConfidence ? "scoped_session" : "cold_start_git_scoped",
      hit_count: sessionHits.length,
    });
    sourceLabels.push("session_vector");
  }

  let scope = new Set<string>();
  let gitScope: Array<{ commit_hash: string; files_changed: string[]; signals?: string[] }> = [];

  if (highConfidence) {
    for (const hit of sessionHits) {
      const links = getLinksForSession(config.sqlitePath, String(hit.session_id));
      for (const link of links) {
        getFilesForCommit(config.sqlitePath, link.sha).forEach((f) => scope.add(f));
      }
    }
  }

  // L2: git pickaxe / blame / intent
  const terms = deriveSearchTerms(opts.query);
  let gitResults = gitHistoryScope(config.repoPath, terms.length ? terms : [opts.query]);
  gitResults = await enrichGitScopeWithIntent(gitResults, config.dataDir, opts.query);
  gitScope = gitResults.map((g) => ({
    commit_hash: g.commit_hash,
    files_changed: g.files_changed,
    signals: g.signals,
  }));

  if (gitScope.length > 0) {
    layers.push({
      layer: 2,
      tool: "git_history_scope",
      certainty: "deterministic",
      mode: "git_history_intent",
      hit_count: gitScope.length,
    });
    for (const sig of gitResults.flatMap((g) => g.signals ?? [])) {
      const label: SourceLabel =
        sig === "intent" ? "git_intent" : sig === "blame" ? "git_blame" : "git_pickaxe";
      if (!sourceLabels.includes(label)) sourceLabels.push(label);
    }
    if (scope.size === 0) {
      gitScope.flatMap((c) => c.files_changed).forEach((f) => scope.add(f));
    }
  }

  // L3: scoped grep
  let grepResult = "";
  if (scope.size > 0) {
    grepResult = searchGrep(config.repoPath, pattern, Array.from(scope));
    layers.push({
      layer: 3,
      tool: "search_sessions_grep",
      certainty: "deterministic",
      mode: "grep_scoped",
      hit_count: grepResult.split("\n").filter(Boolean).length,
    });
    sourceLabels.push("grep_scoped");
  }

  let mode: FallbackMode = "grep_scoped";
  let silentMiss = false;

  if (grepResult.trim().length === 0 && scope.size > 0) {
    const widenedFiles = gitScope.flatMap((c) => c.files_changed);
    if (widenedFiles.length > 0) {
      grepResult = searchGrep(config.repoPath, pattern, widenedFiles);
      mode = "scope_miss_widened_to_git_history";
      layers.push({
        layer: 3,
        tool: "search_sessions_grep",
        certainty: "deterministic",
        mode,
        hit_count: grepResult.split("\n").filter(Boolean).length,
      });
    }
  }

  if (grepResult.trim().length === 0) {
    grepResult = searchGrep(config.repoPath, pattern, []);
    mode = scope.size > 0 ? "scope_miss_widened_to_full_repo" : "cold_start_full_repo";
    layers.push({
      layer: 3,
      tool: "search_sessions_grep",
      certainty: "deterministic",
      mode: "grep_full_repo",
      hit_count: grepResult.split("\n").filter(Boolean).length,
    });
    sourceLabels.push("grep_full_repo");
  }

  if (highConfidence && scope.size > 0 && grepResult.trim().length > 0 && sessionHits[0]._distance > config.confidenceThreshold * 0.8) {
    silentMiss = true;
    mode = "silent_miss_scoped";
    layers.push({ layer: 3, tool: "search_sessions_grep", certainty: "deterministic", mode });
  }

  // L4: ast / diff / keyword refinements
  const refinements: FallbackResult["refinements"] = {};
  const scopedFiles = Array.from(scope).slice(0, 20);
  const symbolTerms = deriveSearchTerms(opts.query).slice(0, 1);

  if (symbolTerms.length > 0 && scopedFiles.length > 0) {
    try {
      refinements.ast = await astSymbolSearch(config.repoPath, config.dataDir, symbolTerms[0], {
        files: scopedFiles,
      });
      layers.push({ layer: 4, tool: "ast_symbol_search", certainty: "deterministic", mode: "ast_refined" });
      sourceLabels.push("ast_symbol");
    } catch {
      // skip
    }
  }

  if (gitScope.length > 0) {
    refinements.diff = diffSearch(config.repoPath, pattern, {
      files: scopedFiles.length ? scopedFiles : undefined,
      commit_range: gitScope[0].commit_hash,
    });
    layers.push({ layer: 4, tool: "diff_search", certainty: "deterministic", mode: "diff_refined" });
    sourceLabels.push("diff_search");
  }

  refinements.keyword = keywordSearch(config.repoPath, undefined, {
    files: scopedFiles.length ? scopedFiles : undefined,
  });
  layers.push({ layer: 4, tool: "keyword_search", certainty: "deterministic", mode: "keyword_refined" });
  sourceLabels.push("keyword_search");

  if (highConfidence && sessionHits.length > 0) {
    mode = silentMiss ? "silent_miss_scoped" : grepResult.trim() ? "scoped_session" : mode;
  } else if (gitScope.length > 0 && grepResult.trim()) {
    mode = "cold_start_git_scoped";
  }

  return {
    mode,
    grep_result: grepResult,
    layers,
    session_matches: sessionHits.map(({ session_id, _distance }) => ({
      session_id: String(session_id),
      _distance,
    })),
    git_scope: gitScope.length ? gitScope : undefined,
    refinements,
    source_labels: sourceLabels,
    source_label: sourceLabels[0] ?? "grep_full_repo",
  };
}
