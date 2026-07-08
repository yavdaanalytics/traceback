import {
  primaryCallServerIdFromRegistry,
  readInstallRegistry,
  TRACEBACK_CONFIG_KEY,
  TRACEBACK_PROTOCOL_NAME,
  TRACEBACK_PROTOCOL_VERSION,
  type InstallRegistry,
} from "../install/registry.js";

export const TRACEBACK_MCP_TOOLS = [
  "get_connection_info",
  "get_traceback_status",
  "search_with_fallback",
  "find_similar_sessions",
  "search_dev_history",
  "git_history_scope",
  "search_sessions_grep",
  "grep_codebase",
  "ast_symbol_search",
  "ast_search",
  "diff_search",
  "keyword_search",
  "blame_current",
  "get_session_detail",
  "get_change_graph",
  "get_session_lineage",
  "get_commit_context",
  "link_session_commit",
  "ingest_session",
  "list_adapters",
  "tag_outcome",
  "get_efficiency_report",
  "submit_feedback",
  "promote_pattern",
  "list_patterns",
  "deprecate_pattern",
  "get_match_details",
  "get_commit_files",
] as const;

export interface ConnectionInfo {
  protocol_name: string;
  protocol_version: string;
  config_key: string;
  call_server_id: string;
  env_call_server_id: string | null;
  install_registry_path: string;
  hosts: InstallRegistry["hosts"];
  tools: readonly string[];
  usage: {
    call_mcp_tool: string;
    claude_native_hook: string;
    fallback: string;
    discovery_hint: string;
  };
  discovery_recommended: boolean;
  first_call_tool: string;
  mandatory_first_tool: string;
}

export function getConnectionInfo(): ConnectionInfo {
  const registry = readInstallRegistry();
  const envId = process.env.TRACEBACK_MCP_SERVER_ID?.trim() || null;
  const callServerId = envId ?? primaryCallServerIdFromRegistry(registry);

  return {
    protocol_name: TRACEBACK_PROTOCOL_NAME,
    protocol_version: TRACEBACK_PROTOCOL_VERSION,
    config_key: TRACEBACK_CONFIG_KEY,
    call_server_id: callServerId,
    env_call_server_id: envId,
    install_registry_path: "~/.traceback/install.json",
    hosts: registry.hosts,
    tools: TRACEBACK_MCP_TOOLS,
    usage: {
      call_mcp_tool: `CallMcpTool server="${callServerId}" toolName="<tool>" (NOT "${TRACEBACK_CONFIG_KEY}" when Cursor global install uses user- prefix).`,
      claude_native_hook: `Native mcp_tool hooks use server="${TRACEBACK_CONFIG_KEY}" (mcp.json config key).`,
      fallback: "If CallMcpTool fails with unknown server, list MCP descriptors under mcps/ for the folder containing search_with_fallback.",
      discovery_hint:
        "Use balanced host-first routing (see SKILL.md): strong/weak matches call traceback, clear non-code skips. On deferred-schema hosts, run ToolSearch/select or call get_traceback_status first.",
    },
    discovery_recommended: true,
    first_call_tool: "get_traceback_status",
    mandatory_first_tool: "search_with_fallback",
  };
}
