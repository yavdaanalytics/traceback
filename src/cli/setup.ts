#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { installHook, installGlobalHook } from "./install-hook.js";

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

export function serverEntry(): Record<string, unknown> {
  return { command: "node", args: [serverEntryPath] };
}

export function sameEntry(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeHostConfig(repoRoot: string, host: HostConfig): void {
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

export function printSnippet(host: HostConfig): void {
  console.log(
    JSON.stringify({ [host.serversKey]: { traceback: serverEntry() } }, null, 2),
  );
}

export function setupGlobalHooks(): void {
  const globalHooksDir = resolve(homedir(), ".traceback", "hooks");
  const globalHooksPath = globalHooksDir.replace(/\\/g, "/");

  // Create global hooks directory
  if (!existsSync(globalHooksDir)) {
    mkdirSync(globalHooksDir, { recursive: true });
    console.log(`traceback: created global hooks directory at ${globalHooksDir}`);
  }

  // Check if global core.hooksPath is already set
  let existingHooksPath = "";
  try {
    existingHooksPath = execFileSync("git", ["config", "--global", "core.hooksPath"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    // No global hooksPath configured yet
  }

  if (existingHooksPath && existingHooksPath !== globalHooksPath) {
    console.warn(
      `traceback: global core.hooksPath already configured at ${existingHooksPath} - ` +
        `not overwriting. If you want traceback hooks to run globally, update it manually or unset it first.`,
    );
    return;
  }

  if (existingHooksPath === globalHooksPath) {
    console.log(`traceback: global core.hooksPath already configured correctly at ${globalHooksPath}`);
    return;
  }

  // Install the global post-commit hook
  installGlobalHook();

  // Set global core.hooksPath
  execFileSync("git", ["config", "--global", "core.hooksPath", globalHooksPath], {
    encoding: "utf-8",
  });
  console.log(
    `traceback: configured global core.hooksPath at ${globalHooksPath} - ` +
      `your post-commit hook will now run on all commits across all repositories`,
  );
}

export function setupClaudeCodeHooks(repoRoot: string): void {
  const claudeSettingsPath = resolve(homedir(), ".claude", "settings.json");
  let settings: Record<string, unknown> = {};

  // Read existing settings if they exist
  if (existsSync(claudeSettingsPath)) {
    const raw = readFileSync(claudeSettingsPath, "utf-8");
    try {
      settings = (JSON.parse(raw) as Record<string, unknown>) ?? {};
    } catch {
      console.warn(
        `traceback: ~/.claude/settings.json is not valid JSON - skipping Claude Code hook setup. ` +
          `Fix the JSON manually and re-run setup if needed.`,
      );
      return;
    }
  } else {
    // Ensure .claude directory exists
    const claudeDir = dirname(claudeSettingsPath);
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }
  }

  // Initialize hooks object if it doesn't exist
  const hooks = (settings.hooks as Record<string, unknown> | undefined) ?? {};
  settings.hooks = hooks;

  // Helper: get matcher object from array or create it
  function getOrCreateMatcher(
    eventName: string,
    matcherStr: string,
  ): { matcher: string; hooks: unknown[] } {
    const eventHooks = (hooks[eventName] as unknown[] | undefined) ?? [];
    let matcherObj = eventHooks.find(
      (h) => (h as Record<string, unknown>)?.matcher === matcherStr,
    ) as { matcher: string; hooks: unknown[] } | undefined;

    if (!matcherObj) {
      matcherObj = { matcher: matcherStr, hooks: [] };
      eventHooks.push(matcherObj);
      hooks[eventName] = eventHooks;
    }

    if (!Array.isArray(matcherObj.hooks)) {
      matcherObj.hooks = [];
    }

    return matcherObj;
  }

  // Helper: check if a hook already exists
  function hookExists(hooksArray: unknown[], toolName: string): boolean {
    return hooksArray.some(
      (h) =>
        (h as Record<string, unknown>)?.type === "mcp_tool" &&
        (h as Record<string, unknown>)?.tool === toolName,
    );
  }

  // UserPromptSubmit hook for traceback search_with_fallback
  const userPromptMatcher = getOrCreateMatcher("UserPromptSubmit", "*");
  if (!hookExists(userPromptMatcher.hooks, "search_with_fallback")) {
    userPromptMatcher.hooks.push({
      type: "mcp_tool",
      server: "traceback",
      tool: "search_with_fallback",
      input: {
        query: "${user_input}",
        repo_path: repoRoot.replace(/\\/g, "/"),
      },
      statusMessage: "Warming up traceback context...",
      async: true,
      asyncRewake: true,
    });
    console.log("traceback: added UserPromptSubmit hook for search_with_fallback");
  } else {
    console.log("traceback: UserPromptSubmit hook for search_with_fallback already exists");
  }

  // PreToolUse hook for Read operations
  const readMatcher = getOrCreateMatcher("PreToolUse", "Read");
  if (!hookExists(readMatcher.hooks, "search_with_fallback")) {
    readMatcher.hooks.push({
      type: "mcp_tool",
      server: "traceback",
      tool: "search_with_fallback",
      input: {
        query: "${tool_input.file_path}",
        repo_path: repoRoot.replace(/\\/g, "/"),
      },
      statusMessage: "Scoping search context...",
      async: true,
    });
    console.log("traceback: added PreToolUse hook for Read operations");
  } else {
    console.log("traceback: PreToolUse hook for Read already exists");
  }

  // Write updated settings back
  writeFileSync(claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  console.log(
    `traceback: configured Claude Code hooks in ~/.claude/settings.json - ` +
      `traceback will now automatically warm context for all your coding sessions`,
  );
}

function main(): void {
  const targetRepoPath = process.argv[2] ?? process.cwd();
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: targetRepoPath,
    encoding: "utf-8",
  }).trim();

  console.log("\n📦 Traceback Installation\n");

  // Step 1: Set up global git hooks
  console.log("🔧 Setting up global git hooks...");
  setupGlobalHooks();

  // Step 2: Set up Claude Code hooks
  console.log("\n🎯 Setting up Claude Code integration...");
  setupClaudeCodeHooks(repoRoot);

  // Step 3: Check if global hooks are already configured
  console.log("\n📍 Checking MCP server registration...");
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
      "\n⚠️  No known host config files were detected in this repo. " +
        "Create one of the files below (or your MCP client's config) and re-run traceback-setup, " +
        "or add the entry manually:",
    );
    for (const host of HOSTS) {
      console.log(`\n${host.name} (${host.relPath}):`);
      printSnippet(host);
    }
  } else {
    console.log("\n✅ Traceback installation complete!");
    console.log(
      "\n💡 What just happened:\n" +
        "  • Global git hooks are now set up at ~/.traceback/hooks\n" +
        "  • Your post-commit hook will run on all commits across repositories\n" +
        "  • Claude Code will automatically warm-start context using traceback on every prompt\n" +
        "  • When you read files, traceback will scope search context automatically\n",
    );
  }
}

// Guarded so tests can import mergeHostConfig/serverEntry/sameEntry/printSnippet
// directly without re-running main() as a side effect of the import (same
// pattern as install-hook.ts).
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath || process.argv[1]?.replace(/\\/g, "/") === scriptPath.replace(/\\/g, "/")) {
  main();
}
