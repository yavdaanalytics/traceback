import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import {
  readInstallRegistry,
  recordHostInstall,
  resolveCallServerId,
  resolveCursorCallServerId,
  TRACEBACK_CONFIG_KEY,
  writeInstallRegistry,
  type InstallRegistry,
} from "../../src/install/registry.js";
import { getConnectionInfo } from "../../src/mcp/connection-info.js";

let registryBackup: InstallRegistry | null = null;
let registryExisted = false;
let tempRegistryPath: string;

beforeEach(() => {
  tempRegistryPath = join(mkdtempSync(join(tmpdir(), "traceback-install-")), "install.json");
  process.env.TRACEBACK_INSTALL_REGISTRY_PATH = tempRegistryPath;

  const path = join(homedir(), ".traceback", "install.json");
  registryExisted = existsSync(path);
  if (registryExisted) {
    registryBackup = readInstallRegistry();
  }
  writeInstallRegistry({
    version: 1,
    protocol_name: "traceback",
    protocol_version: "0.2.0",
    hosts: {},
    updated_at: new Date(0).toISOString(),
  });
});

afterEach(() => {
  delete process.env.TRACEBACK_INSTALL_REGISTRY_PATH;
  const path = join(homedir(), ".traceback", "install.json");
  if (registryBackup && registryExisted) {
    writeInstallRegistry(registryBackup);
  }
  try {
    rmSync(dirname(tempRegistryPath), { recursive: true, force: true });
  } catch {
    // best-effort
  }
  registryBackup = null;
});

describe("install registry", () => {
  it("resolveCallServerId prefixes user- for Cursor global", () => {
    expect(resolveCallServerId("cursor", "global")).toBe("user-traceback");
    expect(resolveCallServerId("cursor", "project")).toBe("traceback");
    expect(resolveCallServerId("claude", "project")).toBe("traceback");
  });

  it("recordHostInstall persists host entries", () => {
    recordHostInstall("cursor-global", {
      config_key: TRACEBACK_CONFIG_KEY,
      call_server_id: "user-traceback",
      scope: "global",
      config_path: "/home/.cursor/mcp.json",
      hook_server_id: TRACEBACK_CONFIG_KEY,
    });

    const registry = readInstallRegistry();
    expect(registry.hosts["cursor-global"]?.call_server_id).toBe("user-traceback");
    expect(registry.updated_at).not.toBe(new Date(0).toISOString());
  });

  it("resolveCursorCallServerId prefers global Cursor config", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "traceback-registry-"));
    try {
      mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
      writeFileSync(
        join(repoRoot, ".cursor", "mcp.json"),
        JSON.stringify({ mcpServers: { traceback: { command: "node" } } }),
      );

      const globalPath = join(homedir(), ".cursor", "mcp.json");
      mkdirSync(dirname(globalPath), { recursive: true });
      let globalBackup: string | null = null;
      let hadGlobal = existsSync(globalPath);
      if (hadGlobal) globalBackup = readFileSync(globalPath, "utf-8");

      writeFileSync(
        globalPath,
        JSON.stringify({ mcpServers: { traceback: { command: "node" } } }, null, 2),
      );

      expect(resolveCursorCallServerId(repoRoot)).toBe("user-traceback");

      if (hadGlobal && globalBackup !== null) {
        writeFileSync(globalPath, globalBackup);
      } else {
        rmSync(globalPath, { force: true });
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("getConnectionInfo", () => {
  it("returns env call server id when set", () => {
    const prev = process.env.TRACEBACK_MCP_SERVER_ID;
    process.env.TRACEBACK_MCP_SERVER_ID = "user-traceback";
    try {
      const info = getConnectionInfo();
      expect(info.call_server_id).toBe("user-traceback");
      expect(info.tools).toContain("get_connection_info");
      expect(info.tools).toContain("search_with_fallback");
    } finally {
      if (prev === undefined) delete process.env.TRACEBACK_MCP_SERVER_ID;
      else process.env.TRACEBACK_MCP_SERVER_ID = prev;
    }
  });
});
