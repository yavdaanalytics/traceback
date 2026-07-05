#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { installHook } from "./install-hook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at dist/cli/setup.js at runtime; dist/ is the package root.
const distDir = dirname(__dirname);
const serverEntryPath = join(distDir, "mcp", "index.js").replace(/\\/g, "/");

// Three hosts whose MCP config traceback can auto-detect and merge into.
// Each host uses a different top-level key and file location - confirmed
// from each host's own MCP documentation, not guessed:
//   - Claude Code: .mcp.json,       key "mcpServers"
//   - Cursor:      .cursor/mcp.json, key "mcpServers"
//   - VS Code/Copilot: .vscode/mcp.json, key "servers"
interface HostConfig {
  name: string;
  relPath: string;
  serversKey: "mcpServers" | "servers";
}

const HOSTS: HostConfig[] = [
  { name: "Claude Code", relPath: ".mcp.json", serversKey: "mcpServers" },
  { name: "Cursor", relPath: ".cursor/mcp.json", serversKey: "mcpServers" },
  { name: "VS Code / GitHub Copilot", relPath: ".vscode/mcp.json", serversKey: "servers" },
];

function serverEntry(): Record<string, unknown> {
  return { command: "node", args: [serverEntryPath] };
}

function sameEntry(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeHostConfig(repoRoot: string, host: HostConfig): void {
  const fullPath = join(repoRoot, host.relPath);
  if (!existsSync(fullPath)) {
    console.log(`traceback: ${host.name} config not found at ${host.relPath} - skipping (not detected as in use)`);
    return;
  }

  const raw = readFileSync(fullPath, "utf-8");
  let parsed: Record<string, unknown>;
  try {
    parsed = raw.trim() === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
  } catch {
    console.warn(`traceback: ${host.relPath} is not valid JSON - skipping to avoid corrupting it. Add manually:`);
    printSnippet(host);
    return;
  }

  const servers = (parsed[host.serversKey] as Record<string, unknown> | undefined) ?? {};
  const existing = servers.traceback;
  const desired = serverEntry();

  if (existing !== undefined && !sameEntry(existing, desired)) {
    console.warn(
      `traceback: ${host.relPath} already has a "traceback" entry under "${host.serversKey}" that differs ` +
        `from what this install would write - leaving it as-is. Existing: ${JSON.stringify(existing)}. ` +
        `Expected: ${JSON.stringify(desired)}.`,
    );
    return;
  }

  if (existing !== undefined) {
    console.log(`traceback: ${host.relPath} already configured correctly - nothing to do.`);
    return;
  }

  parsed[host.serversKey] = { ...servers, traceback: desired };
  writeFileSync(fullPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  console.log(`traceback: added "traceback" to ${host.relPath} under "${host.serversKey}"`);
}

function printSnippet(host: HostConfig): void {
  console.log(
    JSON.stringify({ [host.serversKey]: { traceback: serverEntry() } }, null, 2),
  );
}

function main(): void {
  const targetRepoPath = process.argv[2] ?? process.cwd();
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: targetRepoPath,
    encoding: "utf-8",
  }).trim();

  // Check if global hooks are already configured
  let hasGlobalHooks = false;
  try {
    const globalHooksPath = execFileSync("git", ["config", "--global", "core.hooksPath"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (globalHooksPath) {
      console.log(`traceback: detected global core.hooksPath at ${globalHooksPath}`);
      hasGlobalHooks = true;
    }
  } catch {
    // No global hooksPath configured - will install per-repo hook
  }

  if (!hasGlobalHooks) {
    installHook(repoRoot);
  } else {
    console.log("traceback: skipping per-repo hook installation (global hooks already configured)");
  }

  let anyFound = false;
  for (const host of HOSTS) {
    if (existsSync(join(repoRoot, host.relPath))) anyFound = true;
    mergeHostConfig(repoRoot, host);
  }

  if (!anyFound) {
    console.log(
      "\ntraceback: no known host config files were detected in this repo. " +
        "Create one of the files below (or your MCP client's config) and re-run traceback-setup, " +
        "or add the entry manually:",
    );
    for (const host of HOSTS) {
      console.log(`\n${host.name} (${host.relPath}):`);
      printSnippet(host);
    }
  }
}

main();
