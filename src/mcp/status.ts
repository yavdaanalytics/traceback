import { getConnectionInfo } from "./connection-info.js";
import { countCodingPatterns, getAllSessions, queryInvocations } from "../storage/sqlite.js";

export function getTracebackStatus(
  sqlitePath: string,
  repoPath: string,
  dataDir: string,
): {
  enabled: boolean;
  protocol_version: string;
  call_server_id: string;
  tools_count: number;
  indexed_sessions: number;
  last_ingest_at: number | null;
  patterns_active: number;
  discovery: {
    deferred_schema_hosts: string[];
    recommended_first_tools: string[];
    toolsearch_hint: string;
    host_first_router: {
      mode: "balanced_host_first";
      strong: string;
      weak: string;
      skip: string;
    };
  };
  data_dir: string;
} {
  const info = getConnectionInfo();
  const sessions = getAllSessions(sqlitePath);
  const last = queryInvocations(sqlitePath, {}).at(-1);
  return {
    enabled: true,
    protocol_version: info.protocol_version,
    call_server_id: info.call_server_id,
    tools_count: info.tools.length,
    indexed_sessions: sessions.length,
    last_ingest_at: last?.started_at ?? null,
    patterns_active: countCodingPatterns(sqlitePath, repoPath),
    discovery: {
      deferred_schema_hosts: ["claude-code"],
      recommended_first_tools: ["get_traceback_status", "search_with_fallback", "get_connection_info"],
      toolsearch_hint: "select:mcp__traceback__search_with_fallback,mcp__traceback__get_connection_info",
      host_first_router: {
        mode: "balanced_host_first",
        strong: "If host skill gate is strong, call search_with_fallback immediately.",
        weak: "If host skill gate is weak/ambiguous, still call search_with_fallback as fallback.",
        skip: "Skip traceback only for clearly non-code prompts.",
      },
    },
    data_dir: dataDir,
  };
}

