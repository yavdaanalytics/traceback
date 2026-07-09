#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { installHook, installGlobalHook } from "./install-hook.js";
import {
  recordHostInstall,
  resolveCallServerId,
  resolveCursorCallServerId,
  TRACEBACK_CONFIG_KEY,
  type InstallScope,
} from "../install/registry.js";
import { enableTelemetry, writeTelemetryConfig, readTelemetryConfig } from "../telemetry/config.js";
import {
  DEFAULT_TELEMETRY_ENDPOINT,
  printTelemetryDisclosure,
  telemetryOptOutInstructions,
} from "../telemetry/disclosure.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at dist/cli/setup.js at runtime; dist/ is the package root.
export const distDir = dirname(__dirname);
const serverEntryPath = join(distDir, "mcp", "index.js").replace(/\\/g, "/");

export const TRACEBACK_RULE_MARKER = "<!-- traceback-warm-start -->";
export const TRACEBACK_SERVER_ID_MARKER = "<!-- traceback-mcp-server-id:";
const WARM_START_SCRIPT = "warm-start.js";
const SKILL_FILE_NAME = "SKILL.md";
const SKILL_MARKER = "<!-- traceback-skill -->";

export function warmStartScriptPath(packageDistDir: string = distDir): string {
  return join(packageDistDir, "cli", WARM_START_SCRIPT).replace(/\\/g, "/");
}

export function warmStartCommand(packageDistDir: string, repoRoot: string, format: string): string {
  const script = warmStartScriptPath(packageDistDir);
  const repo = repoRoot.replace(/\\/g, "/");
  return `node "${script}" --format ${format} --repo-path "${repo}"`;
}

function repoSkillSourcePath(repoRoot: string): string {
  return join(repoRoot, SKILL_FILE_NAME);
}

function packageSkillSourcePath(packageDistDir: string = distDir): string {
  return join(dirname(packageDistDir), SKILL_FILE_NAME);
}

function resolveSkillSourcePath(repoRoot: string, packageDistDir: string = distDir): string | null {
  const repoPath = repoSkillSourcePath(repoRoot);
  if (existsSync(repoPath)) return repoPath;
  const packagePath = packageSkillSourcePath(packageDistDir);
  if (existsSync(packagePath)) return packagePath;
  return null;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function writeIfChanged(path: string, content: string): "created" | "updated" | "unchanged" {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
    return "created";
  }
  const existing = normalizeNewlines(readFileSync(path, "utf-8"));
  const desired = normalizeNewlines(content);
  if (existing === desired) return "unchanged";
  writeFileSync(path, content, "utf-8");
  return "updated";
}

export function installTracebackSkills(repoRoot: string, packageDistDir: string = distDir): void {
  const sourcePath = resolveSkillSourcePath(repoRoot, packageDistDir);
  if (!sourcePath) {
    console.warn(
      `traceback: ${SKILL_FILE_NAME} not found at repo root or npm package root - skipping skill installation`,
    );
    return;
  }
  const source = readFileSync(sourcePath, "utf-8");
  const content = source.includes(SKILL_MARKER) ? source : `${source.trimEnd()}\n\n${SKILL_MARKER}\n`;

  const projectCursorDir = process.env.TRACEBACK_CURSOR_PROJECT_SKILLS_DIR?.trim() || join(repoRoot, ".cursor", "skills");
  const globalCursorDir = process.env.TRACEBACK_CURSOR_SKILLS_DIR?.trim() || join(homedir(), ".cursor", "skills");
  const claudeDir = process.env.TRACEBACK_CLAUDE_SKILLS_DIR?.trim() || join(homedir(), ".claude", "skills");
  const targets = [
    { label: "Cursor project", path: join(projectCursorDir, "traceback", SKILL_FILE_NAME) },
    { label: "Cursor global", path: join(globalCursorDir, "traceback", SKILL_FILE_NAME) },
    { label: "Claude Code", path: join(claudeDir, "traceback", SKILL_FILE_NAME) },
  ];

  for (const target of targets) {
    const result = writeIfChanged(target.path, content);
    if (result === "unchanged") {
      console.log(`traceback: ${target.label} skill already up to date at ${target.path}`);
    } else {
      console.log(`traceback: ${result} ${target.label} skill at ${target.path}`);
    }
  }
}

function isWarmStartHookEntry(entry: unknown): boolean {
  const e = entry as Record<string, unknown>;
  if (typeof e.command === "string" && e.command.includes(WARM_START_SCRIPT)) return true;
  const args = e.args;
  if (Array.isArray(args) && args.some((a) => typeof a === "string" && a.includes(WARM_START_SCRIPT))) {
    return true;
  }
  return false;
}

function isWarmStartFormatEntry(entry: unknown, format: string): boolean {
  const e = entry as Record<string, unknown>;
  return typeof e.command === "string" && e.command.includes(WARM_START_SCRIPT) && e.command.includes(format);
}

function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  try {
    return raw.trim() === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function ensureHookArray(
  root: Record<string, unknown>,
  hooksKey: string,
  eventName: string,
): unknown[] {
  const hooks = (root[hooksKey] as Record<string, unknown> | undefined) ?? {};
  root[hooksKey] = hooks;
  const list = (hooks[eventName] as unknown[] | undefined) ?? [];
  hooks[eventName] = list;
  return list;
}

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
  hostId: string;
  scope: InstallScope;
}

const HOSTS: HostConfig[] = [
  { name: "Claude Code", relPath: ".mcp.json", serversKey: "mcpServers", hostId: "claude", scope: "project" },
  { name: "Cursor", relPath: ".cursor/mcp.json", serversKey: "mcpServers", hostId: "cursor", scope: "project" },
  {
    name: "VS Code / GitHub Copilot",
    relPath: ".vscode/mcp.json",
    serversKey: "servers",
    hostId: "vscode",
    scope: "project",
  },
];

export function serverEntry(
  callServerId: string = TRACEBACK_CONFIG_KEY,
  opts?: { pluginInstall?: boolean },
): Record<string, unknown> {
  const env: Record<string, string> = {
    TRACEBACK_MCP_SERVER_ID: callServerId,
    TRACEBACK_MCP_CONFIG_KEY: TRACEBACK_CONFIG_KEY,
  };
  if (opts?.pluginInstall) {
    env.TRACEBACK_TELEMETRY_OPT_IN = "true";
    env.TRACEBACK_TELEMETRY_ENDPOINT = DEFAULT_TELEMETRY_ENDPOINT;
  }
  return {
    command: "node",
    args: [serverEntryPath],
    env,
  };
}

function entriesCompatible(existing: unknown, desired: Record<string, unknown>): boolean {
  if (!existing || typeof existing !== "object") return false;
  const entry = existing as Record<string, unknown>;
  return entry.command === desired.command && JSON.stringify(entry.args) === JSON.stringify(desired.args);
}

export function renderTracebackCursorRule(callServerId: string): string {
  return `---
alwaysApply: true
---
${TRACEBACK_RULE_MARKER}
${TRACEBACK_SERVER_ID_MARKER} ${callServerId} -->

You have access to the **traceback** MCP server for semantic recall over past coding-agent sessions.

## MANDATORY — first tool call (contract violation if skipped)

For **every** user message that is not purely conversational (greetings, thanks, or mode switches), your **first** tool invocation in that turn MUST be:

\`CallMcpTool\` with \`server\` = \`${callServerId}\`, \`toolName\` = \`search_with_fallback\`, \`query\` = the user's full message, \`repo_path\` = workspace git root.

**Forbidden before \`search_with_fallback\` completes:** \`Grep\`, \`Glob\`, \`Task\` (explore), repo-wide reads of SETUP.md/README, or any repo-wide search tool. Cursor \`preToolUse\` hooks block Grep/Glob until you comply.

**MCP routing:** The mcp.json config key is \`traceback\`; Cursor global installs expose \`user-traceback\`. If a call fails with "server does not exist", call \`get_connection_info\` on whichever traceback server is listed under your MCP tools, then retry with the returned \`call_server_id\`.

## After warm-start

1. Use returned \`session_matches\`, \`git_scope\`, and \`grep_result\` to narrow every subsequent read and search.
2. Prefer scoped tools (\`git_history_scope\`, \`search_sessions_grep\` on narrowed files) before repo-wide grep.
3. Do not re-run repo-wide \`Grep\`/\`Glob\` when \`search_with_fallback\` already returned scoped hits.
4. If \`relevant_patterns\` is present, apply that guidance before making edits to avoid repeating known mistakes.

Other useful traceback tools: \`get_connection_info\`, \`get_traceback_status\`, \`find_similar_sessions\`, \`get_session_detail\`, \`get_change_graph\`, \`blame_current\`.
`;
}

export function sameEntry(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeHostConfig(repoRoot: string, host: HostConfig, opts?: { pluginInstall?: boolean }): void {
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
  const existing = servers[TRACEBACK_CONFIG_KEY];
  const callServerId = resolveCallServerId(host.hostId, host.scope);
  const desired = serverEntry(callServerId, { pluginInstall: opts?.pluginInstall });

  if (existing !== undefined && !sameEntry(existing, desired) && !entriesCompatible(existing, desired)) {
    console.warn(
      `traceback: ${host.relPath} already has a "${TRACEBACK_CONFIG_KEY}" entry under "${host.serversKey}" that differs ` +
        `from what this install would write - leaving it as-is. Existing: ${JSON.stringify(existing)}. ` +
        `Expected: ${JSON.stringify(desired)}.`,
    );
    recordHostInstall(host.hostId, {
      config_key: TRACEBACK_CONFIG_KEY,
      call_server_id: callServerId,
      scope: host.scope,
      config_path: fullPath,
      hook_server_id: TRACEBACK_CONFIG_KEY,
    });
    return;
  }

  const mergedEntry =
    existing !== undefined && entriesCompatible(existing, desired)
      ? { ...(existing as Record<string, unknown>), env: (desired.env as Record<string, string>) }
      : desired;

  if (existing !== undefined && sameEntry(existing, mergedEntry)) {
    console.log(`traceback: ${host.relPath} already configured correctly - nothing to do.`);
  } else {
    parsed[host.serversKey] = { ...servers, [TRACEBACK_CONFIG_KEY]: mergedEntry };
    writeFileSync(fullPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    console.log(`traceback: added "${TRACEBACK_CONFIG_KEY}" to ${host.relPath} under "${host.serversKey}"`);
  }

  recordHostInstall(host.hostId, {
    config_key: TRACEBACK_CONFIG_KEY,
    call_server_id: callServerId,
    scope: host.scope,
    config_path: fullPath,
    hook_server_id: TRACEBACK_CONFIG_KEY,
  });
}

export function mergeGlobalCursorConfig(opts?: { pluginInstall?: boolean }): void {
  const globalPath = join(homedir(), ".cursor", "mcp.json");
  if (!existsSync(globalPath)) {
    console.log("traceback: ~/.cursor/mcp.json not found - skipping global Cursor MCP merge");
    return;
  }

  const parsed = readJsonObject(globalPath);
  if (parsed === null) {
    console.warn("traceback: ~/.cursor/mcp.json is not valid JSON - skipping global Cursor MCP merge");
    return;
  }

  const servers = (parsed.mcpServers as Record<string, unknown> | undefined) ?? {};
  const existing = servers[TRACEBACK_CONFIG_KEY];
  const callServerId = resolveCallServerId("cursor", "global");
  const desired = serverEntry(callServerId, { pluginInstall: opts?.pluginInstall });

  if (existing !== undefined && !sameEntry(existing, desired) && !entriesCompatible(existing, desired)) {
    console.warn(
      "traceback: ~/.cursor/mcp.json already has a differing traceback entry - leaving as-is but recording install id",
    );
  } else {
    const mergedEntry =
      existing !== undefined && entriesCompatible(existing, desired)
        ? { ...(existing as Record<string, unknown>), env: (desired.env as Record<string, string>) }
        : desired;

    if (existing === undefined || !sameEntry(existing, mergedEntry)) {
      parsed.mcpServers = { ...servers, [TRACEBACK_CONFIG_KEY]: mergedEntry };
      writeFileSync(globalPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
      console.log(`traceback: merged traceback into ~/.cursor/mcp.json (call_server_id=${callServerId})`);
    } else {
      console.log("traceback: ~/.cursor/mcp.json already configured correctly");
    }
  }

  recordHostInstall("cursor-global", {
    config_key: TRACEBACK_CONFIG_KEY,
    call_server_id: callServerId,
    scope: "global",
    config_path: globalPath,
    hook_server_id: TRACEBACK_CONFIG_KEY,
  });
}

export function printSnippet(host: HostConfig): void {
  const callServerId = resolveCallServerId(host.hostId, host.scope);
  console.log(
    JSON.stringify({ [host.serversKey]: { [TRACEBACK_CONFIG_KEY]: serverEntry(callServerId) } }, null, 2),
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

export function setupCursorHooks(repoRoot: string, packageDistDir: string = distDir): void {
  const mcpPath = join(repoRoot, ".cursor", "mcp.json");
  if (!existsSync(mcpPath)) {
    console.log("traceback: .cursor/mcp.json not found - skipping Cursor hook setup");
    return;
  }

  const hooksPath = join(repoRoot, ".cursor", "hooks.json");
  const hooksDir = dirname(hooksPath);
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const parsed = readJsonObject(hooksPath);
  if (parsed === null) {
    console.warn("traceback: .cursor/hooks.json is not valid JSON - skipping Cursor hook setup");
    return;
  }

  if (parsed.version === undefined) parsed.version = 1;
  const beforeRead = ensureHookArray(parsed, "hooks", "beforeReadFile");
  const warmEntry = { command: warmStartCommand(packageDistDir, repoRoot, "cursor-read"), timeout: 90 };

  if (!beforeRead.some(isWarmStartHookEntry)) {
    beforeRead.push(warmEntry);
    writeFileSync(hooksPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    console.log("traceback: added beforeReadFile hook to .cursor/hooks.json");
  } else {
    console.log("traceback: Cursor beforeReadFile warm-start hook already exists");
  }

  const preToolUse = ensureHookArray(parsed, "hooks", "preToolUse");
  const gateEntry = {
    command: warmStartCommand(packageDistDir, repoRoot, "cursor-gate"),
    matcher: "Grep|Glob",
    timeout: 10,
  };
  if (!preToolUse.some((e) => isWarmStartFormatEntry(e, "cursor-gate"))) {
    preToolUse.push(gateEntry);
    writeFileSync(hooksPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    console.log("traceback: added preToolUse Grep/Glob gate to .cursor/hooks.json");
  } else {
    console.log("traceback: Cursor preToolUse warm-start gate already exists");
  }

  const afterMcp = ensureHookArray(parsed, "hooks", "afterMCPExecution");
  const mcpMarkEntry = {
    command: warmStartCommand(packageDistDir, repoRoot, "cursor-mcp-mark"),
    matcher: "search_with_fallback",
    timeout: 10,
  };
  if (!afterMcp.some((e) => isWarmStartFormatEntry(e, "cursor-mcp-mark"))) {
    afterMcp.push(mcpMarkEntry);
    writeFileSync(hooksPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    console.log("traceback: added afterMCPExecution marker to .cursor/hooks.json");
  } else {
    console.log("traceback: Cursor afterMCPExecution warm-start marker already exists");
  }

  const rulesDir = join(repoRoot, ".cursor", "rules");
  const rulePath = join(rulesDir, "traceback.mdc");
  if (!existsSync(rulesDir)) {
    mkdirSync(rulesDir, { recursive: true });
  }

  const callServerId = resolveCursorCallServerId(repoRoot);
  writeFileSync(rulePath, renderTracebackCursorRule(callServerId), "utf-8");
  console.log(
    `traceback: wrote .cursor/rules/traceback.mdc (call_server_id=${callServerId})`,
  );
}

export function setupVsCodeHooks(repoRoot: string, packageDistDir: string = distDir): void {
  const mcpPath = join(repoRoot, ".vscode", "mcp.json");
  if (!existsSync(mcpPath)) {
    console.log("traceback: .vscode/mcp.json not found - skipping VS Code/Copilot hook setup");
    return;
  }

  const hooksDir = join(repoRoot, ".github", "hooks");
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const hooksPath = join(hooksDir, "traceback-warmstart.json");
  const parsed = readJsonObject(hooksPath);
  if (parsed === null) {
    console.warn("traceback: .github/hooks/traceback-warmstart.json is not valid JSON - skipping");
    return;
  }

  const hooks = (parsed.hooks as Record<string, unknown> | undefined) ?? {};
  parsed.hooks = hooks;

  const promptHooks = (hooks.UserPromptSubmit as unknown[] | undefined) ?? [];
  hooks.UserPromptSubmit = promptHooks;
  const readHooks = (hooks.PreToolUse as unknown[] | undefined) ?? [];
  hooks.PreToolUse = readHooks;

  const cmd = warmStartCommand(packageDistDir, repoRoot, "vscode");
  const promptEntry = { type: "command", command: cmd, timeout: 90 };
  const readEntry = { type: "command", matcher: "Read", command: cmd, timeout: 90 };

  let changed = false;
  if (!promptHooks.some(isWarmStartHookEntry)) {
    promptHooks.push(promptEntry);
    changed = true;
    console.log("traceback: added UserPromptSubmit hook to .github/hooks/traceback-warmstart.json");
  }
  if (!readHooks.some(isWarmStartHookEntry)) {
    readHooks.push(readEntry);
    changed = true;
    console.log("traceback: added PreToolUse Read hook to .github/hooks/traceback-warmstart.json");
  }

  if (!changed) {
    console.log("traceback: VS Code/Copilot warm-start hooks already exist");
    return;
  }

  writeFileSync(hooksPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  console.log("traceback: configured VS Code / GitHub Copilot hooks in .github/hooks/traceback-warmstart.json");
}

export function mergeWindsurfMcpConfig(repoRoot: string): void {
  const mcpPath = join(repoRoot, ".windsurf", "mcp.json");
  if (!existsSync(mcpPath)) return;

  const raw = readFileSync(mcpPath, "utf-8");
  let parsed: Record<string, unknown>;
  try {
    parsed = raw.trim() === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
  } catch {
    console.warn("traceback: .windsurf/mcp.json is not valid JSON - skipping MCP merge");
    return;
  }

  const servers = (parsed.mcpServers as Record<string, unknown> | undefined) ?? {};
  const desired = serverEntry(TRACEBACK_CONFIG_KEY);
  const existing = servers[TRACEBACK_CONFIG_KEY];
  if (existing !== undefined && !sameEntry(existing, desired) && !entriesCompatible(existing, desired)) {
    console.warn("traceback: .windsurf/mcp.json already has a differing traceback entry - leaving as-is");
    return;
  }
  if (existing !== undefined && sameEntry(existing, desired)) {
    console.log("traceback: .windsurf/mcp.json already configured correctly");
    return;
  }

  const mergedEntry =
    existing !== undefined && entriesCompatible(existing, desired)
      ? { ...(existing as Record<string, unknown>), env: (desired.env as Record<string, string>) }
      : desired;

  parsed.mcpServers = { ...servers, [TRACEBACK_CONFIG_KEY]: mergedEntry };
  writeFileSync(mcpPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  console.log("traceback: added traceback to .windsurf/mcp.json");

  recordHostInstall("windsurf", {
    config_key: TRACEBACK_CONFIG_KEY,
    call_server_id: TRACEBACK_CONFIG_KEY,
    scope: "project",
    config_path: mcpPath,
    hook_server_id: TRACEBACK_CONFIG_KEY,
  });
}

export function setupWindsurfHooks(repoRoot: string, packageDistDir: string = distDir): void {
  const windsurfDir = join(repoRoot, ".windsurf");
  const mcpPath = join(windsurfDir, "mcp.json");
  if (!existsSync(windsurfDir) && !existsSync(mcpPath)) {
    console.log("traceback: .windsurf/ not found - skipping Windsurf hook setup");
    return;
  }

  if (!existsSync(windsurfDir)) {
    mkdirSync(windsurfDir, { recursive: true });
  }

  mergeWindsurfMcpConfig(repoRoot);

  const hooksPath = join(windsurfDir, "hooks.json");
  const parsed = readJsonObject(hooksPath);
  if (parsed === null) {
    console.warn("traceback: .windsurf/hooks.json is not valid JSON - skipping Windsurf hook setup");
    return;
  }

  const prePrompt = ensureHookArray(parsed, "hooks", "pre_user_prompt");
  const warmEntry = { command: warmStartCommand(packageDistDir, repoRoot, "windsurf"), timeout: 90 };

  if (prePrompt.some(isWarmStartHookEntry)) {
    console.log("traceback: Windsurf pre_user_prompt warm-start hook already exists");
    return;
  }

  prePrompt.push(warmEntry);
  writeFileSync(hooksPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  console.log("traceback: added pre_user_prompt hook to .windsurf/hooks.json");
}

function resolveTelemetryEnableEndpoint(pluginDefault: boolean): string | null {
  const env = process.env.TRACEBACK_TELEMETRY_ENDPOINT?.trim();
  if (env) return env;
  return pluginDefault ? DEFAULT_TELEMETRY_ENDPOINT : null;
}

export async function promptTelemetryOptIn(opts?: { defaultOptIn?: boolean }): Promise<void> {
  const defaultOptIn = opts?.defaultOptIn ?? false;
  printTelemetryDisclosure({ pluginDefault: defaultOptIn });
  for (const line of telemetryOptOutInstructions()) {
    console.log(`traceback: opt-out — ${line}`);
  }
  console.log("");

  const env = process.env.TRACEBACK_TELEMETRY_OPT_IN?.trim().toLowerCase();
  if (env === "true" || env === "1" || env === "yes") {
    const config = enableTelemetry(resolveTelemetryEnableEndpoint(defaultOptIn));
    console.log(
      `traceback: anonymous telemetry enabled (install_id=${config.install_id}, daily auto-upload on)`,
    );
    console.log("traceback: use traceback-telemetry auto-upload off for manual-only uploads");
    return;
  }
  if (env === "false" || env === "0" || env === "no") {
    console.log("traceback: anonymous telemetry disabled (default)");
    return;
  }
  if (!process.stdin.isTTY) {
    if (defaultOptIn) {
      const config = enableTelemetry(resolveTelemetryEnableEndpoint(defaultOptIn));
      console.log(
        `traceback: anonymous telemetry enabled (install_id=${config.install_id}, daily auto-upload on)`,
      );
      console.log("traceback: use traceback-telemetry auto-upload off for manual-only uploads");
      return;
    }
    console.log("traceback: anonymous telemetry disabled by default (set TRACEBACK_TELEMETRY_OPT_IN=true to enable)");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const prompt = defaultOptIn
      ? "Share anonymous usage metrics? [Y/n] "
      : "Share anonymous usage metrics? [y/N] ";
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    const enabled = defaultOptIn
      ? answer === "" || answer === "y" || answer === "yes"
      : answer === "y" || answer === "yes";
    if (enabled) {
      const config = enableTelemetry(resolveTelemetryEnableEndpoint(defaultOptIn));
      console.log(
        `traceback: anonymous telemetry enabled (install_id=${config.install_id}, daily auto-upload on)`,
      );
      console.log("traceback: use traceback-telemetry auto-upload off for manual-only uploads");
    } else {
      writeTelemetryConfig({
        ...readTelemetryConfig(),
        opt_in: false,
        auto_upload: false,
        declined_sharing: true,
      });
      console.log("traceback: anonymous telemetry disabled");
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const setupArgv = process.argv.filter((arg) => arg !== "--plugin");
  const pluginInstall = process.argv.includes("--plugin");
  const targetRepoPath = setupArgv[2] ?? process.cwd();
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

  console.log("\n🎯 Setting up Cursor integration...");
  setupCursorHooks(repoRoot, distDir);

  console.log("\n🎯 Setting up VS Code / Copilot integration...");
  setupVsCodeHooks(repoRoot, distDir);

  console.log("\n🎯 Setting up Windsurf integration...");
  setupWindsurfHooks(repoRoot, distDir);

  console.log("\n🎯 Installing traceback skill metadata...");
  installTracebackSkills(repoRoot, distDir);

  // Step 3: Check if global hooks are already configured
  console.log("\n📍 Checking MCP server registration...");
  mergeGlobalCursorConfig({ pluginInstall });

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
    mergeHostConfig(repoRoot, host, { pluginInstall });
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
        "  • Claude Code: UserPromptSubmit + PreToolUse warm-start via native MCP hooks\n" +
        "  • Cursor: beforeReadFile hook + preToolUse Grep/Glob gate + always-on rule (call search_with_fallback first)\n" +
        "  • MCP install registry: ~/.traceback/install.json (use get_connection_info for routing id)\n" +
        "  • VS Code / Copilot / JetBrains Copilot: UserPromptSubmit + PreToolUse hooks in .github/hooks/\n" +
        "  • Windsurf: pre_user_prompt hook when .windsurf/ is present\n" +
        "  • Traceback SKILL.md installed/updated for Cursor + Claude host skill paths\n",
    );
  }

  if (pluginInstall) {
    console.log("\n📊 Telemetry (plugin default: ON)");
  } else {
    console.log("\n📊 Telemetry opt-in");
  }
  await promptTelemetryOptIn({ defaultOptIn: pluginInstall });
}

// Guarded so tests can import mergeHostConfig/serverEntry/sameEntry/printSnippet
// directly without re-running main() as a side effect of the import (same
// pattern as install-hook.ts).
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath || process.argv[1]?.replace(/\\/g, "/") === scriptPath.replace(/\\/g, "/")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
