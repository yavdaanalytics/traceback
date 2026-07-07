import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const TRACEBACK_CONFIG_KEY = "traceback";
export const TRACEBACK_PROTOCOL_NAME = "traceback";
export const TRACEBACK_PROTOCOL_VERSION = "0.2.0";

export type InstallScope = "project" | "global" | "user";

export interface HostInstallRecord {
  config_key: string;
  call_server_id: string;
  scope: InstallScope;
  config_path: string;
  /** Native mcp_tool hooks (e.g. Claude Code) reference this id — always the config key. */
  hook_server_id: string;
}

export interface InstallRegistry {
  version: 1;
  protocol_name: string;
  protocol_version: string;
  hosts: Record<string, HostInstallRecord>;
  updated_at: string;
}

function registryPath(): string {
  if (process.env.TRACEBACK_INSTALL_REGISTRY_PATH?.trim()) {
    return process.env.TRACEBACK_INSTALL_REGISTRY_PATH.trim();
  }
  return join(homedir(), ".traceback", "install.json");
}

export function resolveCallServerId(host: string, scope: InstallScope): string {
  // Cursor prefixes globally registered MCP servers with "user-" when routing
  // CallMcpTool / tool descriptors (e.g. traceback → user-traceback).
  if (host === "cursor" && scope === "global") {
    return `user-${TRACEBACK_CONFIG_KEY}`;
  }
  return TRACEBACK_CONFIG_KEY;
}

export function readInstallRegistry(): InstallRegistry {
  const path = registryPath();
  if (!existsSync(path)) {
    return {
      version: 1,
      protocol_name: TRACEBACK_PROTOCOL_NAME,
      protocol_version: TRACEBACK_PROTOCOL_VERSION,
      hosts: {},
      updated_at: new Date(0).toISOString(),
    };
  }
  return JSON.parse(readFileSync(path, "utf-8")) as InstallRegistry;
}

export function writeInstallRegistry(registry: InstallRegistry): void {
  const path = registryPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
}

export function recordHostInstall(hostId: string, record: HostInstallRecord): void {
  const registry = readInstallRegistry();
  registry.hosts[hostId] = record;
  registry.protocol_name = TRACEBACK_PROTOCOL_NAME;
  registry.protocol_version = TRACEBACK_PROTOCOL_VERSION;
  registry.updated_at = new Date().toISOString();
  writeInstallRegistry(registry);
}

/** Prefer global Cursor id when traceback is registered in ~/.cursor/mcp.json. */
export function resolveCursorCallServerId(repoRoot: string): string {
  const globalCursorPath = join(homedir(), ".cursor", "mcp.json");
  if (existsSync(globalCursorPath)) {
    try {
      const parsed = JSON.parse(readFileSync(globalCursorPath, "utf-8")) as {
        mcpServers?: Record<string, unknown>;
      };
      if (parsed.mcpServers?.[TRACEBACK_CONFIG_KEY] !== undefined) {
        return resolveCallServerId("cursor", "global");
      }
    } catch {
      // ignore invalid JSON
    }
  }

  const projectCursorPath = join(repoRoot, ".cursor", "mcp.json");
  if (existsSync(projectCursorPath)) {
    try {
      const parsed = JSON.parse(readFileSync(projectCursorPath, "utf-8")) as {
        mcpServers?: Record<string, unknown>;
      };
      if (parsed.mcpServers?.[TRACEBACK_CONFIG_KEY] !== undefined) {
        return resolveCallServerId("cursor", "project");
      }
    } catch {
      // ignore
    }
  }

  const registry = readInstallRegistry();
  const global = registry.hosts["cursor-global"];
  if (global) return global.call_server_id;
  const project = registry.hosts["cursor"];
  if (project) return project.call_server_id;

  return resolveCallServerId("cursor", "global");
}

export function primaryCallServerIdFromRegistry(registry: InstallRegistry): string {
  const cursorGlobal = registry.hosts["cursor-global"];
  if (cursorGlobal) return cursorGlobal.call_server_id;
  const cursor = registry.hosts["cursor"];
  if (cursor) return cursor.call_server_id;
  for (const record of Object.values(registry.hosts)) {
    return record.call_server_id;
  }
  return process.env.TRACEBACK_MCP_SERVER_ID ?? TRACEBACK_CONFIG_KEY;
}
