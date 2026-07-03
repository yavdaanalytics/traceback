#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { availableAdapters, listAdapters } from "../adapters/registry.js";
import { resolveConfig } from "../config.js";
import { embedText } from "../embedding/embedder.js";
import { linkSessionToCommit } from "../git/linkage.js";
import { ingestStaleSessions } from "../ingest/indexer.js";
import { getCommitContext, getSessionLineage } from "./lineage.js";
import { astSearch, blameCurrent, searchGrep } from "./search.js";
import { searchSimilarTurns } from "../storage/lancedb.js";
import { getFilesForCommit, getLinksForSession, setOutcome } from "../storage/sqlite.js";

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
  async ({ query, top_k, project_path }) => {
    const vector = await embedText(query);
    const results = await searchSimilarTurns(config.dataDir, vector, top_k, project_path);
    // Strip the raw embedding vectors before returning - they're dead weight
    // in an LLM tool result (this is exactly the context-bloat problem the
    // funnel exists to avoid) and are never needed by the caller.
    const trimmed = results.map(({ vector: _vector, ...rest }) => rest);
    return {
      content: [{ type: "text", text: JSON.stringify(trimmed, null, 2) }],
    };
  },
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
  async ({ pattern, files, language, repo_path }) => {
    const output = astSearch(repo_path ?? config.repoPath, pattern, files, language);
    return { content: [{ type: "text", text: output || "(no matches)" }] };
  },
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
  async ({ file, historical_commit, line_or_symbol, repo_path }) => {
    const output = blameCurrent(repo_path ?? config.repoPath, file, historical_commit, line_or_symbol);
    return { content: [{ type: "text", text: output }] };
  },
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
  async ({ session_id, commit_sha, direction, hops }) => {
    const nodes = getSessionLineage(
      config.sqlitePath,
      { sessionId: session_id, commitSha: commit_sha },
      direction,
      hops,
    );
    return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
  },
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
  async ({ session_id, commit_sha, repo_path }) => {
    linkSessionToCommit(config.sqlitePath, repo_path ?? config.repoPath, session_id, commit_sha, "manual", 1.0);
    return { content: [{ type: "text", text: `Linked session ${session_id} to commit ${commit_sha}` }] };
  },
);

server.registerTool(
  "get_commit_context",
  {
    description:
      "Reverse lookup: given a bare commit SHA (e.g. from git blame), return linked session(s), files/docs touched, and outcome tag - the 'why is this here' answer.",
    inputSchema: { commit_sha: z.string() },
  },
  async ({ commit_sha }) => {
    const context = getCommitContext(config.sqlitePath, commit_sha);
    return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
  },
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
  async ({ adapter_id, project_path }) => {
    const result = await ingestStaleSessions(config, { adapterId: adapter_id, projectPath: project_path });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "list_adapters",
  {
    description:
      "Introspection: which session adapters are registered, which report isAvailable()=true on this machine - useful for debugging why a session isn't showing up.",
    inputSchema: {},
  },
  async () => {
    const all = listAdapters().map((a) => ({ id: a.id, available: a.isAvailable() }));
    return { content: [{ type: "text", text: JSON.stringify(all, null, 2) }] };
  },
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
  async ({ commit_sha, outcome, evidence }) => {
    setOutcome(config.sqlitePath, { sha: commit_sha, outcome, derived_at: Date.now(), evidence: evidence ?? null });
    return { content: [{ type: "text", text: `Tagged ${commit_sha} as ${outcome}` }] };
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
