#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { availableAdapters, listAdapters } from "../adapters/registry.js";
import { resolveConfig } from "../config.js";
import { deriveSearchTerms, gitHistoryScope } from "../git/history-scope.js";
import { linkSessionToCommit } from "../git/linkage.js";
import { ingestStaleSessions } from "../ingest/indexer.js";
import { submitFeedback } from "./feedback.js";
import { getCommitContext, getSessionLineage } from "./lineage.js";
import { astSearch, blameCurrent, searchGrep } from "./search.js";
import { computeGrepBaseline, renderEfficiencyReport, withTelemetry } from "./telemetry.js";
import { findSimilarSessions, type SessionSearchResult } from "./recall.js";
import { searchWithFallback } from "./fallback.js";
import { getCommit, getFilesForCommit, getLinksForSession, setOutcome } from "../storage/sqlite.js";

const config = resolveConfig();

const server = new McpServer({ name: "traceback", version: "0.1.0" });

server.registerTool(
  "find_similar_sessions",
  {
    description:
      "Cosine-similarity search over past coding-agent session/turn embeddings. Primary recall step: 'which past session did X'. Narrows scope for ast_search/search_sessions_grep - not a final answer on its own.",
    inputSchema: {
      query: z.string().describe("Natural-language description of the problem/symptom to search for"),
      top_k: z.number().int().positive().max(50).optional().default(5),
      project_path: z.string().optional().describe("Restrict results to this repo/project path"),
    },
  },
  withTelemetry(
    config.sqlitePath,
    "find_similar_sessions",
    async ({ query, top_k, project_path }) => {
      const results = await findSimilarSessions(config, query, top_k, project_path);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
    (_args, result) => {
      const first = JSON.parse(result.content[0].text as string) as Array<{ session_id: string; timestamp: number }>;
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
  "git_history_scope",
  {
    description:
      "Cold-start scoping via git log (pickaxe) and git blame. Derives search terms from a natural-language query and returns top commits that touched related code, with their changed files. Useful for fallback scope narrowing when session-vector search finds nothing or has low confidence.",
    inputSchema: {
      terms: z.array(z.string()).min(1).describe("Search terms for git log -S (pickaxe); usually derived from deriveSearchTerms(query)"),
      file: z.string().optional().describe("Optional: if given, also run git blame -C on this file to find the most recent touching commit"),
      line: z.number().int().positive().optional().describe("Optional: line number for blame -L; ignored if file is not given"),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(
    config.sqlitePath,
    "git_history_scope",
    async ({ terms, file, line, repo_path }) => {
      const results = gitHistoryScope(repo_path ?? config.repoPath, terms, { file, line });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
    ({ terms, file }, result) => {
      const parsed = JSON.parse(result.content[0].text as string) as Array<{ commit_hash: string; files_changed: string[] }>;
      const filesCount = parsed.reduce((sum, r) => sum + r.files_changed.length, 0);
      return {
        deltaWindowScale: filesCount,
        matchedRef: parsed.length > 0 ? parsed[0].commit_hash : undefined,
      };
    },
  ),
);

server.registerTool(
  "ast_search",
  {
    description:
      "Structural pattern match (via the ast-grep CLI) scoped to specific candidate files - survives renames/reformatting that plain grep misses. Run after find_similar_sessions to search only the files it surfaced.",
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
      return { content: [{ type: "text", text: output || "(no matches)" }] };
    },
    ({ pattern, files, repo_path }, result) => ({
      deltaWindowScale: files.length,
      warmLinesPulled: (result.content[0].text as string).split("\n").filter(Boolean).length,
      // ast-grep has no `-c` count mode; reuse the same textual-pattern grep
      // count as the "cheap unscoped baseline" proxy for this tool too.
      baselineLines: computeGrepBaseline(repo_path ?? config.repoPath, pattern),
    }),
  ),
);

server.registerTool(
  "search_sessions_grep",
  {
    description:
      "Exact/regex text search via `git grep`, scoped to specific files (the semantic/AST-narrowed candidate set). The final precision pass - the 'warm start' means this never has to scan the whole repo.",
    inputSchema: {
      pattern: z.string(),
      session_ids: z.array(z.string()).optional().describe("If given, scope search to files these sessions' linked commits touched"),
      scope: z.array(z.string()).optional().describe("Explicit file/dir paths to search"),
      repo_path: z.string().optional(),
    },
  },
  withTelemetry(
    config.sqlitePath,
    "search_sessions_grep",
    async ({ pattern, session_ids, scope, repo_path }) => {
      const repoPath = repo_path ?? config.repoPath;
      let files = scope ?? [];
      if (session_ids?.length) {
        const commitFiles = session_ids
          .flatMap((sid) => getLinksForSession(config.sqlitePath, sid))
          .flatMap((link) => getFilesForCommit(config.sqlitePath, link.sha));
        files = [...files, ...commitFiles];
      }
      const output = searchGrep(repoPath, pattern, files);
      return { content: [{ type: "text", text: output || "(no matches)" }] };
    },
    ({ pattern, session_ids, scope, repo_path }, result) => {
      const repoPath = repo_path ?? config.repoPath;
      const links = (session_ids ?? []).flatMap((sid) => getLinksForSession(config.sqlitePath, sid));
      const shas = [...new Set(links.map((l) => l.sha))];
      const commits = shas.map((sha) => getCommit(config.sqlitePath, sha)).filter((c) => c != null);
      const oldest = commits.reduce<number | null>(
        (min, c) => (c.author_date != null && (min == null || c.author_date < min) ? c.author_date : min),
        null,
      );
      return {
        deltaWindowScale: (scope?.length ?? 0) + shas.length,
        warmLinesPulled: (result.content[0].text as string).split("\n").filter(Boolean).length,
        baselineLines: computeGrepBaseline(repoPath, pattern),
        gitDepthDays: oldest != null ? (Date.now() - oldest) / 86_400_000 : undefined,
        matchedRef: shas[0],
      };
    },
  ),
);

server.registerTool(
  "blame_current",
  {
    description:
      "Resolves a match found in a historical commit to where it actually lives in HEAD today (git blame / git log -L --follow). The matched code may have moved, been renamed, or been refactored since.",
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
    description:
      "Graph walk: ordered chain of linked commits/sessions before/after a given session or commit, including derived relations (reverts/fixes/follows) and outcome tags.",
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
      const nodes = getSessionLineage(
        config.sqlitePath,
        { sessionId: session_id, commitSha: commit_sha },
        direction,
        hops,
      );
      return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
    },
    (args, result) => {
      const nodes = JSON.parse(result.content[0].text as string) as Array<{
        sha: string;
        authorDate: number | null;
      }>;
      if (nodes.length === 0) return undefined;
      const oldest = nodes.reduce<number | null>(
        (min, n) => (n.authorDate != null && (min == null || n.authorDate < min) ? n.authorDate : min),
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
  "link_session_commit",
  {
    description:
      "Manually link (or correct) a session-to-commit association. Overrides the git hook's heuristic guess when it's wrong (concurrent sessions, delayed commits, cherry-picks).",
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
    description:
      "Reverse lookup: given a bare commit SHA (e.g. from git blame), return linked session(s), files/docs touched, and outcome tag - the 'why is this here' answer.",
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
    description:
      "Explicitly trigger the lazy incremental indexer (backfill/troubleshooting). Also called implicitly by other tools and the git post-commit hook.",
    inputSchema: {
      adapter_id: z.string().optional(),
      project_path: z.string().optional(),
    },
  },
  withTelemetry(config.sqlitePath, "ingest_session", async ({ adapter_id, project_path }) => {
    const result = await ingestStaleSessions(config, { adapterId: adapter_id, projectPath: project_path });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }),
);

server.registerTool(
  "list_adapters",
  {
    description:
      "Introspection: which session adapters are registered, which report isAvailable()=true on this machine - useful for debugging why a session isn't showing up.",
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
    description:
      "Manual override of outcome-tagging heuristics for a commit (kept/reverted/broke_build/superseded/unknown), since automatic derivation has false negatives.",
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
    description:
      "Aggregates traceback's own tool-call telemetry (recorded automatically on every call) into a text summary: call counts, avg latency, line-reduction vs. an unscoped git-grep baseline, and avg git-history depth of matches. Use to sanity-check whether the semantic funnel is actually saving context/tokens.",
    inputSchema: {
      since: z.number().optional().describe("Epoch ms; only include calls at or after this time"),
      tool_name: z.string().optional().describe("Restrict to one tool's telemetry"),
    },
  },
  // Not wrapped in withTelemetry - avoids the tool recursively logging calls
  // about its own reporting.
  async ({ since, tool_name }) => {
    const text = renderEfficiencyReport(config.sqlitePath, { since, toolName: tool_name });
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "search_with_fallback",
  {
    description:
      "Orchestrated warm-start search: tries session-vector matches first, then git-history pickaxe, then full-repo grep, logging every decision branch for eval. Returns both the grep result and the scoping decisions (mode + sources), so every search decision is auditable and the confidence threshold can be tuned empirically.",
    inputSchema: {
      query: z.string().describe("Natural-language description of the problem/symptom to search for"),
      pattern: z.string().optional().describe("Optional explicit regex pattern for grep; if omitted, derived from deriveSearchTerms(query)"),
      project_path: z.string().optional().describe("Optional: restrict to sessions from this repo/project path"),
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
        },
        { query, pattern, project_path },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
    (args, result) => {
      const parsed = JSON.parse(result.content[0].text as string) as { mode: string; grep_result: string; git_scope?: Array<{ commit_hash: string; files_changed: string[] }>; session_matches?: Array<{ session_id: string }> };
      const filesCount = (parsed.git_scope ?? []).reduce((sum, c) => sum + c.files_changed.length, 0);
      const lines = parsed.grep_result.split("\n").filter(Boolean).length;
      const sessionMatches = parsed.session_matches ?? [];
      const sessionRef = sessionMatches.length > 0 ? sessionMatches[0].session_id : undefined;
      const gitRef = parsed.git_scope?.[0]?.commit_hash;
      return {
        mode: parsed.mode,
        deltaWindowScale: filesCount,
        warmLinesPulled: lines,
        baselineLines: computeGrepBaseline(args.repo_path ?? config.repoPath, args.pattern ?? args.query),
        matchedRef: sessionRef ?? gitRef,
      };
    },
  ),
);

server.registerTool(
  "submit_feedback",
  {
    description:
      "Persists a human verdict on a prior traceback result. IMPORTANT usage contract: traceback has no separate propose-plan step - the calling agent must first present its reasoning/matched-session/plan to the user in normal chat, get an explicit yes/no from them, and ONLY THEN call this tool with the resulting verdict. Do not call this before the user has responded. On verdict='reject', the linked session's future find_similar_sessions ranking is penalized (down-weighted, not deleted) so it surfaces less readily next time.",
    inputSchema: {
      invocation_id: z
        .number()
        .int()
        .optional()
        .describe("The invocation_id of the traceback tool call this feedback is about (not required if session_id is given)"),
      session_id: z.string().optional().describe("Session this feedback concerns, if not tied to one specific invocation"),
      verdict: z.enum(["confirm", "reject"]),
      note: z.string().optional(),
    },
  },
  // Not wrapped in withTelemetry - the feedback table already records this.
  async ({ invocation_id, session_id, verdict, note }) => {
    const result = submitFeedback(config.sqlitePath, { invocationId: invocation_id, sessionId: session_id, verdict, note });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

async function main(): Promise<void> {
  // Warm the adapter registry once at startup so isAvailable() checks (and any
  // future startup diagnostics) don't pay first-call cost inside a tool call.
  availableAdapters();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("traceback MCP server failed to start:", error);
  process.exit(1);
});
