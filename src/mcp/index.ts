#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { availableAdapters, listAdapters } from "../adapters/registry.js";
import { resolveConfig } from "../config.js";
import { deriveSearchTerms, gitHistoryScope, enrichGitScopeWithIntent } from "../git/history-scope.js";
import { kickOffCommitEmbeddingIndex } from "../git/commit-embedder.js";
import { linkSessionToCommit } from "../git/linkage.js";
import { ingestStaleSessions } from "../ingest/indexer.js";
import { submitFeedback } from "./feedback.js";
import { getCommitContext } from "./lineage.js";
import { getChangeGraph, getSessionLineageFromGraph } from "./change-graph.js";
import { astSearch, blameCurrent, searchGrep } from "./search.js";
import { computeGrepBaseline, renderEfficiencyReport, withTelemetry } from "./telemetry.js";
import { findSimilarSessionsWithContext } from "./recall.js";
import { searchWithFallback } from "./fallback.js";
import { getCommit, getFilesForCommit, getLinksForSession, setOutcome } from "../storage/sqlite.js";
import { wrapWithMeta, type SourceLabel } from "./labels.js";
import { getSessionDetail } from "./session-detail.js";
import { astSymbolSearch } from "../ast/symbol-search.js";
import { diffSearch, keywordSearch } from "./code-search.js";
import { getConnectionInfo } from "./connection-info.js";
import { getCommitFiles, getMatchDetails } from "./match-details.js";
import { serializeForMCP, summarizeFallbackForAgent } from "./payload-formatter.js";
import {
  deactivateCodingPattern,
  insertCodingPattern,
  listCodingPatterns,
  queryInvocations,
  touchCodingPattern,
} from "../storage/sqlite.js";
import { getRelevantPatternsForQuery, suggestPatternsFromInvocations } from "./pattern-suggest.js";
import { getTracebackStatus } from "./status.js";

const config = resolveConfig();

const server = new McpServer({ name: "traceback", version: "0.2.0" });

server.registerTool(
  "get_connection_info",
  {
    description:
      "Returns how to route MCP calls to this traceback server: call_server_id for CallMcpTool, config_key for mcp.json, and per-host install records from ~/.traceback/install.json. Call this first if search_with_fallback fails with an unknown server name.",
    inputSchema: {},
  },
  async () => {
    const info = getConnectionInfo();
    return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
  },
);

server.registerTool(
  "get_traceback_status",
  {
    description: "Returns current traceback availability, indexed session counts, and discovery hints for deferred-schema hosts.",
    inputSchema: { repo_path: z.string().optional() },
  },
  async ({ repo_path }) => {
    const status = getTracebackStatus(config.sqlitePath, repo_path ?? config.repoPath, config.dataDir);
    return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
  },
);

const findSimilarSchema = {
  query: z.string().describe("Natural-language description of the problem/symptom to search for"),
  top_k: z.number().int().positive().max(50).optional().default(5),
  project_path: z.string().optional().describe("Restrict results to this repo/project path"),
};

async function handleFindSimilar(args: {
  query: string;
  top_k?: number;
  project_path?: string;
  outcome?: string;
  source_tool?: string;
  tags?: string;
}) {
  const results = await findSimilarSessionsWithContext(config, args.query, args.top_k ?? 5, args.project_path, {
    adapter_id: args.source_tool,
    outcome: args.outcome,
    tags: args.tags,
  });
  return wrapWithMeta(results, {
    source: "session_vector",
    certainty: "probabilistic",
    layer: 1,
    ...(results.length === 0 ? { confidence: "none" as const } : {}),
  });
}

server.registerTool(
  "find_similar_sessions",
  {
    description:
      "Cosine-similarity search over past coding-agent session embeddings (embedding_text digest only). Primary recall step: 'which past session did X'.",
    inputSchema: findSimilarSchema,
  },
  withTelemetry(
    config.sqlitePath,
    "find_similar_sessions",
    async (args) => {
      const payload = await handleFindSimilar(args);
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
    (_args, result) => {
      const parsed = JSON.parse(result.content[0].text as string) as { data: Array<{ session_id: string; timestamp: number }> };
      const first = parsed.data ?? [];
      if (first.length === 0) return undefined;
      return {
        deltaWindowScale: first.length,
        matchedRef: first[0].session_id,
        gitDepthDays: (Date.now() - first[0].timestamp) / 86_400_000,
      };
    },
  ),
);

server.registerTool(
  "search_dev_history",
  {
    description: "Alias for find_similar_sessions with optional outcome/source_tool/tags filters.",
    inputSchema: {
      ...findSimilarSchema,
      outcome: z.string().optional(),
      source_tool: z.string().optional().describe("Filter by adapter_id (claude-code, cursor, copilot)"),
      tags: z.string().optional().describe("JSON metadata substring filter (optional)"),
    },
  },
  withTelemetry(config.sqlitePath, "search_dev_history", async (args) => {
    const payload = await handleFindSimilar(args);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }),
);

server.registerTool(
  "git_history_scope",
  {
    description:
      "Cold-start scoping via git log (pickaxe), git blame, and commit-message intent embeddings.",
    inputSchema: {
      terms: z.array(z.string()).optional().describe("Search terms for git log -S; derived from query if omitted"),
      query: z.string().optional().describe("Natural-language query; derives terms and intent hits"),
      file: z.string().optional(),
      line: z.number().int().positive().optional(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(
    config.sqlitePath,
    "git_history_scope",
    async ({ terms, query, file, line, repo_path }) => {
      kickOffCommitEmbeddingIndex(config.dataDir, config.sqlitePath, repo_path ?? config.repoPath);
      const resolvedTerms = terms ?? (query ? deriveSearchTerms(query) : []);
      if (resolvedTerms.length === 0 && query) resolvedTerms.push(query);
      let results = gitHistoryScope(repo_path ?? config.repoPath, resolvedTerms, { file, line });
      if (query) results = await enrichGitScopeWithIntent(results, config.dataDir, query);
      const payload = wrapWithMeta(results, { source: "git_pickaxe", certainty: "deterministic", layer: 2 });
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
    ({ terms, file }, result) => {
      const parsed = JSON.parse(result.content[0].text as string) as {
        data: Array<{ commit_hash: string; files_changed: string[] }>;
      };
      const rows = parsed.data ?? [];
      const filesCount = rows.reduce((sum, r) => sum + r.files_changed.length, 0);
      return {
        deltaWindowScale: filesCount,
        matchedRef: rows.length > 0 ? rows[0].commit_hash : undefined,
      };
    },
  ),
);

server.registerTool(
  "ast_search",
  {
    description: "Structural pattern match (ast-grep CLI) scoped to candidate files.",
    inputSchema: {
      pattern: z.string(),
      files: z.array(z.string()).min(1),
      language: z.string().optional(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(
    config.sqlitePath,
    "ast_search",
    async ({ pattern, files, language, repo_path }) => {
      const output = astSearch(repo_path ?? config.repoPath, pattern, files, language);
      const payload = wrapWithMeta(output || "(no matches)", { source: "ast_grep", certainty: "deterministic", layer: 4 });
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
    ({ pattern, files, repo_path }, result) => ({
      deltaWindowScale: files.length,
      warmLinesPulled: JSON.parse(result.content[0].text as string).data?.split?.("\n")?.filter(Boolean)?.length ?? 0,
      baselineLines: computeGrepBaseline(repo_path ?? config.repoPath, pattern),
    }),
  ),
);

server.registerTool(
  "ast_symbol_search",
  {
    description: "Local tree-sitter/regex symbol search for definitions and usages in scoped files.",
    inputSchema: {
      symbol_name: z.string(),
      type: z.string().optional(),
      scope: z.string().optional(),
      path: z.string().optional(),
      files: z.array(z.string()).optional(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "ast_symbol_search", async ({ symbol_name, type, scope, path, files, repo_path }) => {
    const output = await astSymbolSearch(repo_path ?? config.repoPath, config.dataDir, symbol_name, {
      type,
      scope,
      path,
      files,
    });
    const payload = wrapWithMeta(output, { source: "ast_symbol", certainty: "deterministic", layer: 4 });
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }),
);

server.registerTool(
  "diff_search",
  {
    description: "Search git history patches for a pattern, optionally scoped to commits/files.",
    inputSchema: {
      pattern: z.string(),
      files: z.array(z.string()).optional(),
      commit_range: z.string().optional(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "diff_search", async ({ pattern, files, commit_range, repo_path }) => {
    const output = diffSearch(repo_path ?? config.repoPath, pattern, { files, commit_range });
    const payload = wrapWithMeta(output || "(no matches)", { source: "diff_search", certainty: "deterministic", layer: 4 });
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }),
);

server.registerTool(
  "keyword_search",
  {
    description: "Search for TODO/FIXME/BUG/XXX/HACK/NOTE markers or a custom keyword via git grep.",
    inputSchema: {
      keyword: z.string().optional(),
      path: z.string().optional(),
      files: z.array(z.string()).optional(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "keyword_search", async ({ keyword, path, files, repo_path }) => {
    const output = keywordSearch(repo_path ?? config.repoPath, keyword, { path, files });
    const payload = wrapWithMeta(output || "(no matches)", { source: "keyword_search", certainty: "deterministic", layer: 4 });
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }),
);

const grepSchema = {
  pattern: z.string(),
  session_ids: z.array(z.string()).optional(),
  scope: z.array(z.string()).optional(),
  repo_path: z.string().optional(),
};

async function handleGrep(args: { pattern: string; session_ids?: string[]; scope?: string[]; repo_path?: string }) {
  const repoPath = args.repo_path ?? config.repoPath;
  let files = args.scope ?? [];
  if (args.session_ids?.length) {
    const commitFiles = args.session_ids
      .flatMap((sid) => getLinksForSession(config.sqlitePath, sid))
      .flatMap((link) => getFilesForCommit(config.sqlitePath, link.sha));
    files = [...files, ...commitFiles];
  }
  const output = searchGrep(repoPath, args.pattern, files);
  return wrapWithMeta(output || "(no matches)", { source: "grep_scoped", certainty: "deterministic", layer: 3 });
}

server.registerTool(
  "search_sessions_grep",
  {
    description: "Exact/regex text search via git grep, scoped to specific files.",
    inputSchema: grepSchema,
  },
  withTelemetry(
    config.sqlitePath,
    "search_sessions_grep",
    async (args) => {
      const payload = await handleGrep(args);
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
    ({ pattern, session_ids, scope, repo_path }, result) => {
      const repoPath = repo_path ?? config.repoPath;
      const parsed = JSON.parse(result.content[0].text as string) as { data: string };
      return {
        deltaWindowScale: (scope?.length ?? 0) + (session_ids?.length ?? 0),
        warmLinesPulled: (parsed.data ?? "").split("\n").filter(Boolean).length,
        baselineLines: computeGrepBaseline(repoPath, pattern),
      };
    },
  ),
);

server.registerTool(
  "grep_codebase",
  {
    description: "Alias for search_sessions_grep.",
    inputSchema: grepSchema,
  },
  withTelemetry(config.sqlitePath, "grep_codebase", async (args) => {
    const payload = await handleGrep(args);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }),
);

server.registerTool(
  "blame_current",
  {
    description: "Resolves a historical match to its location in HEAD today.",
    inputSchema: {
      file: z.string(),
      historical_commit: z.string(),
      line_or_symbol: z.string(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "blame_current", async ({ file, historical_commit, line_or_symbol, repo_path }) => {
    const output = blameCurrent(repo_path ?? config.repoPath, file, historical_commit, line_or_symbol);
    return { content: [{ type: "text", text: output }] };
  }),
);

server.registerTool(
  "get_session_lineage",
  {
    description: "Graph walk delegating to get_change_graph for backward compatibility.",
    inputSchema: {
      session_id: z.string().optional(),
      commit_sha: z.string().optional(),
      direction: z.enum(["forward", "backward", "both"]).optional().default("both"),
      hops: z.number().int().positive().max(10).optional().default(2),
    },
  },
  withTelemetry(
    config.sqlitePath,
    "get_session_lineage",
    async ({ session_id, commit_sha, direction, hops }) => {
      const nodes = getSessionLineageFromGraph(
        config.sqlitePath,
        config.repoPath,
        { sessionId: session_id, commitSha: commit_sha },
        direction,
        hops,
      );
      return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
    },
    (args, result) => {
      const nodes = JSON.parse(result.content[0].text as string) as Array<{ author_date: number | null }>;
      if (nodes.length === 0) return undefined;
      const oldest = nodes.reduce<number | null>(
        (min, n) => (n.author_date != null && (min == null || n.author_date < min) ? n.author_date : min),
        null,
      );
      return {
        deltaWindowScale: nodes.length,
        gitDepthDays: oldest != null ? (Date.now() - oldest) / 86_400_000 : undefined,
        matchedRef: args.commit_sha ?? args.session_id,
      };
    },
  ),
);

server.registerTool(
  "get_change_graph",
  {
    description: "Timeline API: direct and nearby commits with edge mapping and context window.",
    inputSchema: {
      session_id: z.string().optional(),
      commit_sha: z.string().optional(),
      before: z.number().int().optional().default(3),
      after: z.number().int().optional().default(3),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "get_change_graph", async ({ session_id, commit_sha, before, after, repo_path }) => {
    const graph = getChangeGraph(config.sqlitePath, repo_path ?? config.repoPath, {
      sessionId: session_id,
      commitSha: commit_sha,
    }, { before, after });
    return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
  }),
);

server.registerTool(
  "get_session_detail",
  {
    description: "SQLite session row + embedding_text + transcript_ref + linked attempts/commits.",
    inputSchema: {
      session_id: z.string(),
      include_raw: z.boolean().optional().default(false),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "get_session_detail", async ({ session_id, include_raw, repo_path }) => {
    const detail = getSessionDetail(config.sqlitePath, session_id, {
      includeRaw: include_raw,
      repoPath: repo_path ?? config.repoPath,
    });
    return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
  }),
);

server.registerTool(
  "link_session_commit",
  {
    description: "Manually link (or correct) a session-to-commit association.",
    inputSchema: {
      session_id: z.string(),
      commit_sha: z.string(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "link_session_commit", async ({ session_id, commit_sha, repo_path }) => {
    linkSessionToCommit(config.sqlitePath, repo_path ?? config.repoPath, session_id, commit_sha, "manual", 1.0);
    return { content: [{ type: "text", text: `Linked session ${session_id} to commit ${commit_sha}` }] };
  }),
);

server.registerTool(
  "get_commit_context",
  {
    description: "Reverse lookup: commit SHA to linked sessions, files, outcome.",
    inputSchema: { commit_sha: z.string() },
  },
  withTelemetry(config.sqlitePath, "get_commit_context", async ({ commit_sha }) => {
    const context = getCommitContext(config.sqlitePath, commit_sha);
    return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
  }),
);

server.registerTool(
  "ingest_session",
  {
    description: "Trigger lazy incremental indexer (backfill/troubleshooting).",
    inputSchema: {
      adapter_id: z.string().optional(),
      project_path: z.string().optional(),
      session_id: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "ingest_session", async ({ adapter_id, project_path, session_id }) => {
    const result = await ingestStaleSessions(
      { ...config, repoPath: config.repoPath, sessionGapMs: config.sessionGapMs },
      { adapterId: adapter_id, projectPath: project_path, sessionId: session_id },
    );
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }),
);

server.registerTool(
  "list_adapters",
  {
    description: "Which session adapters are registered and available on this machine.",
    inputSchema: {},
  },
  withTelemetry(config.sqlitePath, "list_adapters", async () => {
    const all = listAdapters().map((a) => ({ id: a.id, available: a.isAvailable() }));
    return { content: [{ type: "text", text: JSON.stringify(all, null, 2) }] };
  }),
);

server.registerTool(
  "tag_outcome",
  {
    description: "Manual override of outcome-tagging heuristics for a commit.",
    inputSchema: {
      commit_sha: z.string(),
      outcome: z.enum(["kept", "reverted", "broke_build", "superseded", "unknown"]),
      evidence: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "tag_outcome", async ({ commit_sha, outcome, evidence }) => {
    setOutcome(config.sqlitePath, { sha: commit_sha, outcome, derived_at: Date.now(), evidence: evidence ?? null });
    return { content: [{ type: "text", text: `Tagged ${commit_sha} as ${outcome}` }] };
  }),
);

server.registerTool(
  "get_efficiency_report",
  {
    description: "Aggregates tool-call telemetry into a text summary.",
    inputSchema: {
      since: z.number().optional(),
      tool_name: z.string().optional(),
    },
  },
  async ({ since, tool_name }) => {
    const text = renderEfficiencyReport(config.sqlitePath, { since, toolName: tool_name });
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "search_with_fallback",
  {
    description: "4-layer orchestrated warm-start search: session cosine → git → grep → ast/diff/keyword.",
    inputSchema: {
      query: z.string(),
      pattern: z.string().optional(),
      project_path: z.string().optional(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(
    config.sqlitePath,
    "search_with_fallback",
    async ({ query, pattern, project_path, repo_path }) => {
      const result = await searchWithFallback(
        {
          repoPath: repo_path ?? config.repoPath,
          dataDir: config.dataDir,
          sqlitePath: config.sqlitePath,
          confidenceThreshold: config.confidenceThreshold,
          keywordRouterEnabled: config.keywordRouterEnabled,
          keywordStrongThreshold: config.keywordStrongThreshold,
          keywordWeakThreshold: config.keywordWeakThreshold,
        },
        { query, pattern, project_path },
      );
      const relevantPatterns = getRelevantPatternsForQuery(config.sqlitePath, repo_path ?? config.repoPath, query);
      const summary = summarizeFallbackForAgent(result, { maxGrepLines: 40, omitEmptyRefinements: true });
      if (relevantPatterns.length > 0) {
        summary.relevant_patterns = relevantPatterns;
        for (const pattern of relevantPatterns) touchCodingPattern(config.sqlitePath, pattern.pattern_id);
      }
      const suggestions = suggestPatternsFromInvocations(queryInvocations(config.sqlitePath, { toolName: "search_with_fallback" }));
      if (suggestions.length > 0) {
        summary.pattern_suggestions = suggestions;
      }
      const payload = wrapWithMeta(summary, {
        source: (result.source_labels[0] ?? "grep_full_repo") as SourceLabel,
        certainty: result.layers[0]?.certainty ?? "deterministic",
      });
      return { content: [{ type: "text", text: serializeForMCP(payload as unknown as Record<string, unknown>, true) }] };
    },
    (args, result) => {
      const parsed = JSON.parse(result.content[0].text as string) as {
        data: {
          mode: string;
          grep_summary?: { total_hits?: number };
          git_scope?: { commits?: Array<{ file_count?: number }> };
          layer4_skipped?: boolean;
          trigger_diagnostics?: { score?: number; decision?: "strong" | "weak" | "skip"; terms_count?: number };
        };
      };
      const inner = parsed.data;
      const filesCount = (inner.git_scope?.commits ?? []).reduce((sum, c) => sum + (c.file_count ?? 0), 0);
      const responseChars = String(result.content[0].text).length;
      const responseTokensEst = Math.ceil(responseChars / 4);
      const baselineTokensEst = Math.ceil(JSON.stringify(parsed, null, 2).length / 4);
      return {
        mode: inner.mode,
        deltaWindowScale: filesCount,
        warmLinesPulled: inner.grep_summary?.total_hits ?? 0,
        baselineLines: computeGrepBaseline(args.repo_path ?? config.repoPath, args.pattern ?? args.query),
        responseChars,
        responseTokensEst,
        baselineTokensEst,
        layer4Skipped: Boolean(inner.layer4_skipped),
        triggerScore: inner.trigger_diagnostics?.score,
        triggerDecision: inner.trigger_diagnostics?.decision,
        triggerTermsCount: inner.trigger_diagnostics?.terms_count,
      };
    },
  ),
);

server.registerTool(
  "get_match_details",
  {
    description: "Fetches full code snippet around a grep hit on demand.",
    inputSchema: {
      file: z.string(),
      line_start: z.number().int().positive(),
      line_end: z.number().int().positive(),
      context_lines: z.number().int().nonnegative().optional().default(3),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "get_match_details", async ({ file, line_start, line_end, context_lines, repo_path }) => {
    const detail = getMatchDetails(repo_path ?? config.repoPath, file, line_start, line_end, context_lines);
    return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
  }),
);

server.registerTool(
  "get_commit_files",
  {
    description: "Returns full files_changed list for a commit hash.",
    inputSchema: {
      commit_sha: z.string(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "get_commit_files", async ({ commit_sha, repo_path }) => {
    const files = getCommitFiles(repo_path ?? config.repoPath, commit_sha);
    return { content: [{ type: "text", text: JSON.stringify({ commit_sha, files }, null, 2) }] };
  }),
);

server.registerTool(
  "promote_pattern",
  {
    description:
      "Stores a reusable coding pattern. IMPORTANT: call only after explicit user confirmation, mirroring submit_feedback HITL contract.",
    inputSchema: {
      title: z.string(),
      trigger_text: z.string(),
      guidance: z.string(),
      source_session_id: z.string().optional(),
      source_invocation_id: z.number().int().optional(),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(
    config.sqlitePath,
    "promote_pattern",
    async ({ title, trigger_text, guidance, source_session_id, source_invocation_id, repo_path }) => {
      const patternId = insertCodingPattern(config.sqlitePath, {
        repo_path: repo_path ?? config.repoPath,
        title,
        trigger_text,
        guidance,
        source_session_id: source_session_id ?? null,
        source_invocation_id: source_invocation_id ?? null,
        created_at: Date.now(),
      });
      return { content: [{ type: "text", text: JSON.stringify({ pattern_id: patternId }, null, 2) }] };
    },
  ),
);

server.registerTool(
  "list_patterns",
  {
    description: "Lists active promoted coding patterns for this repository.",
    inputSchema: { repo_path: z.string().optional() },
  },
  withTelemetry(config.sqlitePath, "list_patterns", async ({ repo_path }) => {
    const rows = listCodingPatterns(config.sqlitePath, repo_path ?? config.repoPath);
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }),
);

server.registerTool(
  "deprecate_pattern",
  {
    description: "Marks a promoted coding pattern as inactive.",
    inputSchema: { pattern_id: z.number().int().positive() },
  },
  withTelemetry(config.sqlitePath, "deprecate_pattern", async ({ pattern_id }) => {
    deactivateCodingPattern(config.sqlitePath, pattern_id);
    return { content: [{ type: "text", text: JSON.stringify({ pattern_id, active: false }, null, 2) }] };
  }),
);

server.registerTool(
  "submit_feedback",
  {
    description:
      "Persists a human verdict on a prior traceback result. IMPORTANT usage contract: traceback has no separate propose-plan step - the calling agent must first present its reasoning/matched-session/plan to the user in normal chat, get an explicit yes/no from them, and ONLY THEN call this tool with the resulting verdict. Do not call this before the user has responded. On verdict='reject', the linked session's future find_similar_sessions ranking is penalized (down-weighted, not deleted) so it surfaces less readily next time.",
    inputSchema: {
      invocation_id: z.number().int().optional(),
      session_id: z.string().optional(),
      verdict: z.enum(["confirm", "reject"]),
      note: z.string().optional(),
    },
  },
  async ({ invocation_id, session_id, verdict, note }) => {
    const result = submitFeedback(config.sqlitePath, { invocationId: invocation_id, sessionId: session_id, verdict, note });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

async function main(): Promise<void> {
  availableAdapters();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("traceback MCP server failed to start:", error);
  process.exit(1);
});
