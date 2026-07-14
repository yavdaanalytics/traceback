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

export { TRACEBACK_CONFIG_KEY };
import { enableTelemetry, writeTelemetryConfig, readTelemetryConfig } from "../telemetry/config.js";
import {
  DEFAULT_TELEMETRY_ENDPOINT,
  printTelemetryDisclosure,
  telemetryOptOutInstructions,
} from "../telemetry/disclosure.js";
import {
  resolveCommandMode,
  mcpServerEntryDev,
  mcpServerEntryPortable,
  npxPackageBin,
  warmStartCommandDev,
  warmStartCommandPortable,
} from "./command-paths.js";
import { applyExcludeMode, type ExcludeMode } from "./git-excludes.js";
import { printDoctorReport, runSetupDoctor } from "./setup-doctor.js";
import { mergeClaudeMdOnboarding } from "./claude-md-onboarding.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at dist/cli/setup.js at runtime; dist/ is the package root.
export const distDir = dirname(__dirname);

export const TRACEBACK_RULE_MARKER = "<!-- traceback-warm-start -->";
export const TRACEBACK_SERVER_ID_MARKER = "<!-- traceback-mcp-server-id:";
const WARM_START_SCRIPT = "warm-start.js";
const WARM_START_BIN = "traceback-warmstart";
const SKILL_FILE_NAME = "SKILL.md";
const SKILL_MARKER = "<!-- traceback-skill -->";

export function warmStartScriptPath(packageDistDir: string = distDir): string {
  return join(packageDistDir, "cli", WARM_START_SCRIPT).replace(/\\/g, "/");
}

export function warmStartCommand(
  packageDistDir: string,
  format: string,
  repoRoot?: string,
): string {
  const mode = resolveCommandMode(packageDistDir);
  if (mode === "dev") {
    return warmStartCommandDev(warmStartScriptPath(packageDistDir), format, repoRoot);
  }
  return warmStartCommandPortable(format, repoRoot);
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

  const globalCursorDir = process.env.TRACEBACK_CURSOR_SKILLS_DIR?.trim() || join(homedir(), ".cursor", "skills");
  const claudeDir = process.env.TRACEBACK_CLAUDE_SKILLS_DIR?.trim() || join(homedir(), ".claude", "skills");
  const targets = [
    { label: "Cursor global", path: join(globalCursorDir, "traceback", SKILL_FILE_NAME) },
    { label: "Claude Code global", path: join(claudeDir, "traceback", SKILL_FILE_NAME) },
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
  if (typeof e.command === "string") {
    if (e.command.includes(WARM_START_SCRIPT) || e.command.includes(WARM_START_BIN)) return true;
  }
  const args = e.args;
  if (Array.isArray(args) && args.some((a) => typeof a === "string" && (a.includes(WARM_START_SCRIPT) || a.includes(WARM_START_BIN)))) {
    return true;
  }
  return false;
}

function isWarmStartFormatEntry(entry: unknown, format: string): boolean {
  const e = entry as Record<string, unknown>;
  if (typeof e.command !== "string") return false;
  return (
    (e.command.includes(WARM_START_SCRIPT) || e.command.includes(WARM_START_BIN)) &&
    e.command.includes(format)
  );
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
  opts?: { pluginInstall?: boolean; packageDistDir?: string },
): Record<string, unknown> {
  const packageDistDir = opts?.packageDistDir ?? distDir;
  const env: Record<string, string> = {
    TRACEBACK_MCP_SERVER_ID: callServerId,
    TRACEBACK_MCP_CONFIG_KEY: TRACEBACK_CONFIG_KEY,
  };
  if (opts?.pluginInstall) {
    env.TRACEBACK_TELEMETRY_OPT_IN = "true";
    env.TRACEBACK_TELEMETRY_ENDPOINT = DEFAULT_TELEMETRY_ENDPOINT;
  }
  const mode = resolveCommandMode(packageDistDir);
  const entryPath = join(packageDistDir, "mcp", "index.js").replace(/\\/g, "/");
  const cmd = mode === "dev" ? mcpServerEntryDev(entryPath) : mcpServerEntryPortable();
  return { ...cmd, env };
}

function entriesCompatible(existing: unknown, desired: Record<string, unknown>): boolean {
  if (!existing || typeof existing !== "object") return false;
  const entry = existing as Record<string, unknown>;
  if (entry.command === desired.command && JSON.stringify(entry.args) === JSON.stringify(desired.args)) {
    return true;
  }
  // Treat portable npx and dev node entries as compatible when env matches.
  const portable = mcpServerEntryPortable();
  const isPortable =
    (entry.command === portable.command && JSON.stringify(entry.args) === JSON.stringify(portable.args)) ||
    (entry.command === "node" && Array.isArray(entry.args));
  const desiredPortable =
    desired.command === portable.command || (desired.command === "node" && Array.isArray(desired.args));
  return isPortable && desiredPortable;
}

export function renderTracebackCursorRule(callServerId: string): string {
  return `---
description: Traceback warm-start — call search_with_fallback before Grep/Glob on code/debug turns
alwaysApply: true
---
${TRACEBACK_RULE_MARKER}
${TRACEBACK_SERVER_ID_MARKER} ${callServerId} -->

You have access to the **traceback** MCP server for semantic recall over past coding-agent sessions.
When relevant, read the global skill at \`~/.cursor/skills/traceback/SKILL.md\` (or the bundled plugin skill).

## MANDATORY — first tool call (contract violation if skipped)

For **every** user message that is not purely conversational (greetings, thanks, or mode switches), your **first** tool invocation in that turn MUST be:

\`CallMcpTool\` with \`server\` = \`${callServerId}\`, \`toolName\` = \`search_with_fallback\`, \`query\` = the user's full message, \`repo_path\` = workspace git root.

Prefer \`GetMcpTools\` on that server first if the tool schema is unknown. **Forbidden before \`search_with_fallback\` completes:** \`Grep\`, \`Glob\`, \`Task\` (explore), repo-wide reads of SETUP.md/README, or any repo-wide search tool. Cursor \`preToolUse\` hooks block Grep/Glob until you comply.

**MCP routing:** The mcp.json config key is \`traceback\`; Cursor global installs expose \`user-traceback\`. If a call fails with "server does not exist", call \`get_connection_info\` on whichever traceback server is listed under your MCP tools, then retry with the returned \`call_server_id\`.

## Host-first routing

Apply the \`traceback\` skill metadata (\`routing_mode: balanced_host_first\`):

- **strong** or **weak** keyword match → call \`search_with_fallback\`
- **skip** only for clearly non-code prompts (weather, jokes, etc.)

## After warm-start

1. Use returned \`session_matches\`, \`git_scope\`, and \`grep_result\` to narrow every subsequent read and search.
2. Prefer scoped tools (\`git_history_scope\`, \`search_sessions_grep\` on narrowed files) before repo-wide grep.
3. Do not re-run repo-wide \`Grep\`/\`Glob\` when \`search_with_fallback\` already returned scoped hits.
4. If \`relevant_patterns\` is present, apply that guidance before making edits to avoid repeating known mistakes.

Other useful traceback tools: \`get_connection_info\`, \`get_traceback_status\`, \`find_similar_sessions\`, \`get_session_detail\`, \`get_change_graph\`, \`blame_current\`.
`;
}

/** Global always-on Cursor rule (~/.cursor/rules/traceback.mdc) for all workspaces. */
export function installGlobalCursorRule(opts?: { callServerId?: string }): void {
  const rulesDir =
    process.env.TRACEBACK_CURSOR_RULES_DIR?.trim() || join(homedir(), ".cursor", "rules");
  const rulePath = join(rulesDir, "traceback.mdc");
  const callServerId = opts?.callServerId ?? resolveCallServerId("cursor", "global");
  const content = renderTracebackCursorRule(callServerId);
  const result = writeIfChanged(rulePath, content);
  if (result === "unchanged") {
    console.log(`traceback: Cursor global rule already up to date at ${rulePath}`);
  } else {
    console.log(`traceback: ${result} Cursor global rule at ${rulePath} (call_server_id=${callServerId})`);
  }
}

/** Portable Cursor warm-start hooks (no hardcoded repo path; resolves from workspace). */
export function portableCursorHooksConfig(): Record<string, unknown> {
  return {
    version: 1,
    hooks: {
      beforeReadFile: [{ command: warmStartCommandPortable("cursor-read"), timeout: 90 }],
      preToolUse: [
        {
          command: warmStartCommandPortable("cursor-gate"),
          matcher: "Grep|Glob",
          timeout: 10,
        },
      ],
      afterMCPExecution: [
        {
          command: warmStartCommandPortable("cursor-mcp-mark"),
          matcher: "search_with_fallback",
          timeout: 10,
        },
      ],
    },
  };
}

/**
 * Portable Claude Code warm-start hooks (repo resolved from hook stdin cwd).
 *
 * Claude Code only supports `type: "command"` hooks that receive JSON on stdin
 * and inject context via `hookSpecificOutput.additionalContext` on stdout —
 * there is no `mcp_tool` hook type and no `${...}` variable interpolation.
 * Only UserPromptSubmit is wired: PreToolUse does not support additionalContext,
 * so plain stdout there never reaches the model.
 */
export function portableClaudeHooksConfig(): Record<string, unknown> {
  return {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: npxPackageBin(WARM_START_BIN, ["--format", "claude"]),
              timeout: 90,
            },
          ],
        },
      ],
    },
  };
}

/** Portable plugin MCP entry (npx + plugin telemetry defaults). */
export function portablePluginMcpConfig(): Record<string, unknown> {
  return {
    mcpServers: {
      traceback: {
        ...mcpServerEntryPortable(),
        env: {
          TRACEBACK_MCP_SERVER_ID: TRACEBACK_CONFIG_KEY,
          TRACEBACK_MCP_CONFIG_KEY: TRACEBACK_CONFIG_KEY,
          TRACEBACK_TELEMETRY_OPT_IN: "true",
          TRACEBACK_TELEMETRY_ENDPOINT: DEFAULT_TELEMETRY_ENDPOINT,
          // Node 22 needs this for node:sqlite; harmless on Node 23+.
          NODE_OPTIONS: "--experimental-sqlite",
        },
      },
    },
  };
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
  const desired = serverEntry(callServerId, { pluginInstall: opts?.pluginInstall, packageDistDir: distDir });

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
  mkdirSync(dirname(globalPath), { recursive: true });

  const existingParsed = readJsonObject(globalPath);
  if (existingParsed === null && existsSync(globalPath)) {
    console.warn("traceback: ~/.cursor/mcp.json is not valid JSON - skipping global Cursor MCP merge");
    return;
  }
  const parsed = existingParsed ?? {};

  const servers = (parsed.mcpServers as Record<string, unknown> | undefined) ?? {};
  const existing = servers[TRACEBACK_CONFIG_KEY];
  const callServerId = resolveCallServerId("cursor", "global");
  const desired = serverEntry(callServerId, { pluginInstall: opts?.pluginInstall, packageDistDir: distDir });

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

export function mergeGlobalClaudeConfig(opts?: { pluginInstall?: boolean }): void {
  const globalPath = join(homedir(), ".claude", ".mcp.json");
  mkdirSync(dirname(globalPath), { recursive: true });

  const existingParsed = readJsonObject(globalPath);
  if (existingParsed === null && existsSync(globalPath)) {
    console.warn("traceback: ~/.claude/.mcp.json is not valid JSON - skipping global Claude MCP merge");
    return;
  }
  const parsed = existingParsed ?? {};
  const servers = (parsed.mcpServers as Record<string, unknown> | undefined) ?? {};
  const existing = servers[TRACEBACK_CONFIG_KEY];
  const callServerId = resolveCallServerId("claude", "global");
  const desired = serverEntry(callServerId, { pluginInstall: opts?.pluginInstall, packageDistDir: distDir });

  if (existing !== undefined && !sameEntry(existing, desired) && !entriesCompatible(existing, desired)) {
    console.warn(
      "traceback: ~/.claude/.mcp.json already has a differing traceback entry - leaving as-is but recording install id",
    );
  } else {
    const mergedEntry =
      existing !== undefined && entriesCompatible(existing, desired)
        ? { ...(existing as Record<string, unknown>), env: (desired.env as Record<string, string>) }
        : desired;

    if (existing === undefined || !sameEntry(existing, mergedEntry)) {
      parsed.mcpServers = { ...servers, [TRACEBACK_CONFIG_KEY]: mergedEntry };
      writeFileSync(globalPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
      console.log(`traceback: merged traceback into ~/.claude/.mcp.json (call_server_id=${callServerId})`);
    } else {
      console.log("traceback: ~/.claude/.mcp.json already configured correctly");
    }
  }

  recordHostInstall("claude-global", {
    config_key: TRACEBACK_CONFIG_KEY,
    call_server_id: callServerId,
    scope: "global",
    config_path: globalPath,
    hook_server_id: TRACEBACK_CONFIG_KEY,
  });
}

export function setupGlobalCursorHooks(packageDistDir: string = distDir): void {
  const hooksPath = join(homedir(), ".cursor", "hooks.json");
  mkdirSync(dirname(hooksPath), { recursive: true });

  const parsed = readJsonObject(hooksPath) ?? {};
  if (parsed.version === undefined) parsed.version = 1;

  const beforeRead = ensureHookArray(parsed, "hooks", "beforeReadFile");
  const warmEntry = { command: warmStartCommand(packageDistDir, "cursor-read"), timeout: 90 };
  if (!beforeRead.some(isWarmStartHookEntry)) {
    beforeRead.push(warmEntry);
    console.log("traceback: added global beforeReadFile hook to ~/.cursor/hooks.json");
  } else {
    console.log("traceback: global Cursor beforeReadFile warm-start hook already exists");
  }

  const preToolUse = ensureHookArray(parsed, "hooks", "preToolUse");
  const gateEntry = {
    command: warmStartCommand(packageDistDir, "cursor-gate"),
    matcher: "Grep|Glob",
    timeout: 10,
  };
  if (!preToolUse.some((e) => isWarmStartFormatEntry(e, "cursor-gate"))) {
    preToolUse.push(gateEntry);
    console.log("traceback: added global preToolUse Grep/Glob gate to ~/.cursor/hooks.json");
  }

  const afterMcp = ensureHookArray(parsed, "hooks", "afterMCPExecution");
  const mcpMarkEntry = {
    command: warmStartCommand(packageDistDir, "cursor-mcp-mark"),
    matcher: "search_with_fallback",
    timeout: 10,
  };
  if (!afterMcp.some((e) => isWarmStartFormatEntry(e, "cursor-mcp-mark"))) {
    afterMcp.push(mcpMarkEntry);
    console.log("traceback: added global afterMCPExecution marker to ~/.cursor/hooks.json");
  }

  writeFileSync(hooksPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  console.log(`traceback: configured global Cursor hooks at ${hooksPath}`);
}

export function printSnippet(host: HostConfig): void {
  const callServerId = resolveCallServerId(host.hostId, host.scope);
  console.log(
    JSON.stringify({ [host.serversKey]: { [TRACEBACK_CONFIG_KEY]: serverEntry(callServerId) } }, null, 2),
  );
}

export function setupGlobalHooks(opts?: { chainHooks?: boolean; packageDistDir?: string }): void {
  const packageDistDir = opts?.packageDistDir ?? distDir;
  const globalHooksDir = resolve(homedir(), ".traceback", "hooks");
  const globalHooksPath = globalHooksDir.replace(/\\/g, "/");

  if (!existsSync(globalHooksDir)) {
    mkdirSync(globalHooksDir, { recursive: true });
    console.log(`traceback: created global hooks directory at ${globalHooksDir}`);
  }

  let existingHooksPath = "";
  try {
    existingHooksPath = execFileSync("git", ["config", "--global", "core.hooksPath"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    // No global hooksPath configured yet
  }

  if (existingHooksPath && existingHooksPath.replace(/\\/g, "/") !== globalHooksPath) {
    if (!opts?.chainHooks) {
      console.warn(
        `traceback: global core.hooksPath already configured at ${existingHooksPath} - ` +
          `not overwriting. Re-run with --chain-hooks to chain the existing post-commit hook, ` +
          `or unset core.hooksPath first.`,
      );
      return;
    }
    installGlobalHook({ chainFrom: existingHooksPath, packageDistDir });
    execFileSync("git", ["config", "--global", "core.hooksPath", globalHooksPath], {
      encoding: "utf-8",
    });
    console.log(
      `traceback: chained existing hooks at ${existingHooksPath} and set core.hooksPath to ${globalHooksPath}`,
    );
    return;
  }

  if (existingHooksPath.replace(/\\/g, "/") === globalHooksPath) {
    installGlobalHook({ packageDistDir });
    console.log(`traceback: global core.hooksPath already configured correctly at ${globalHooksPath}`);
    return;
  }

  installGlobalHook({ packageDistDir });
  execFileSync("git", ["config", "--global", "core.hooksPath", globalHooksPath], {
    encoding: "utf-8",
  });
  console.log(
    `traceback: configured global core.hooksPath at ${globalHooksPath} - ` +
      `your post-commit hook will now run on all commits across all repositories`,
  );
}

/** Env override so tests never touch the real ~/.claude/settings.json. */
export function claudeSettingsPath(): string {
  const override = process.env.TRACEBACK_CLAUDE_SETTINGS_PATH?.trim();
  return override || resolve(homedir(), ".claude", "settings.json");
}

function isTracebackWarmStartHook(hook: unknown): boolean {
  const h = hook as Record<string, unknown> | null;
  if (!h) return false;
  // Legacy invalid schema (type: "mcp_tool") that Claude Code never executed.
  if (h.type === "mcp_tool" && h.server === "traceback") return true;
  if (h.type === "command" && typeof h.command === "string") {
    return h.command.includes(WARM_START_BIN) || h.command.includes(WARM_START_SCRIPT);
  }
  return false;
}

/** Remove traceback entries (including legacy mcp_tool ones) from a hook event array. */
function stripTracebackHooks(eventHooks: unknown[]): unknown[] {
  const kept: unknown[] = [];
  for (const entry of eventHooks) {
    const matcherObj = entry as { hooks?: unknown[] } | null;
    if (!matcherObj || !Array.isArray(matcherObj.hooks)) {
      kept.push(entry);
      continue;
    }
    matcherObj.hooks = matcherObj.hooks.filter((h) => !isTracebackWarmStartHook(h));
    if (matcherObj.hooks.length > 0) kept.push(entry);
  }
  return kept;
}

export function setupClaudeCodeHooks(
  repoRoot: string,
  opts?: { global?: boolean },
  packageDistDir: string = distDir,
): void {
  const settingsPath = claudeSettingsPath();
  let settings: Record<string, unknown> = {};

  // Read existing settings if they exist
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf-8");
    try {
      settings = (JSON.parse(raw) as Record<string, unknown>) ?? {};
    } catch {
      console.warn(
        `traceback: ${settingsPath} is not valid JSON - skipping Claude Code hook setup. ` +
          `Fix the JSON manually and re-run setup if needed.`,
      );
      return;
    }
  } else {
    const claudeDir = dirname(settingsPath);
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }
  }

  const hooks = (settings.hooks as Record<string, unknown> | undefined) ?? {};
  settings.hooks = hooks;

  // Migrate: drop stale traceback hooks (legacy mcp_tool schema was never valid
  // in Claude Code; PreToolUse cannot inject context so it is no longer wired).
  for (const eventName of ["UserPromptSubmit", "PreToolUse"]) {
    const eventHooks = hooks[eventName] as unknown[] | undefined;
    if (!Array.isArray(eventHooks)) continue;
    const cleaned = stripTracebackHooks(eventHooks);
    if (cleaned.length > 0) {
      hooks[eventName] = cleaned;
    } else {
      delete hooks[eventName];
    }
  }

  // UserPromptSubmit command hook: Claude Code pipes {prompt, cwd, ...} JSON on
  // stdin; the warm-start CLI resolves the repo from cwd and injects context via
  // hookSpecificOutput.additionalContext.
  const command = warmStartCommand(
    packageDistDir,
    "claude",
    opts?.global ? undefined : repoRoot,
  );
  const userPromptHooks = (hooks.UserPromptSubmit as unknown[] | undefined) ?? [];
  userPromptHooks.push({
    hooks: [{ type: "command", command, timeout: 90 }],
  });
  hooks.UserPromptSubmit = userPromptHooks;
  console.log("traceback: added UserPromptSubmit warm-start command hook");

  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  console.log(
    `traceback: configured Claude Code hooks in ${settingsPath} - ` +
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
  const warmEntry = { command: warmStartCommand(packageDistDir, "cursor-read", repoRoot), timeout: 90 };

  if (!beforeRead.some(isWarmStartHookEntry)) {
    beforeRead.push(warmEntry);
    writeFileSync(hooksPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    console.log("traceback: added beforeReadFile hook to .cursor/hooks.json");
  } else {
    console.log("traceback: Cursor beforeReadFile warm-start hook already exists");
  }

  const preToolUse = ensureHookArray(parsed, "hooks", "preToolUse");
  const gateEntry = {
    command: warmStartCommand(packageDistDir, "cursor-gate", repoRoot),
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
    command: warmStartCommand(packageDistDir, "cursor-mcp-mark", repoRoot),
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

  const cmd = warmStartCommand(packageDistDir, "vscode", repoRoot);
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
  const warmEntry = { command: warmStartCommand(packageDistDir, "windsurf", repoRoot), timeout: 90 };

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

interface SetupCliOptions {
  pluginInstall: boolean;
  repoOnly: boolean;
  doctor: boolean;
  chainHooks: boolean;
  allRepos: boolean | null;
  excludeMode: ExcludeMode | null;
  skipClaudeMd: boolean;
  claudeMdOnly: boolean;
  targetRepoPath: string;
}

function parseSetupCli(argv: string[]): SetupCliOptions {
  const pluginInstall = argv.includes("--plugin");
  const repoOnly = argv.includes("--repo-only");
  const doctor = argv.includes("--doctor");
  const chainHooks = argv.includes("--chain-hooks");
  const useGitignore = argv.includes("--use-gitignore");
  const skipClaudeMd = argv.includes("--skip-claude-md");
  const claudeMdOnly = argv.includes("--claude-md-only");
  const filtered = argv.filter(
    (a) =>
      ![
        "--plugin",
        "--repo-only",
        "--doctor",
        "--chain-hooks",
        "--use-gitignore",
        "--yes-all-repos",
        "--no-all-repos",
        "--skip-claude-md",
        "--claude-md-only",
      ].includes(a) && !a.startsWith("--exclude-mode="),
  );

  let allRepos: boolean | null = null;
  if (argv.includes("--yes-all-repos")) allRepos = true;
  if (argv.includes("--no-all-repos")) allRepos = false;
  const envAll = process.env.TRACEBACK_SETUP_ALL_REPOS?.trim().toLowerCase();
  if (envAll === "true" || envAll === "1" || envAll === "yes") allRepos = true;
  if (envAll === "false" || envAll === "0" || envAll === "no") allRepos = false;

  let excludeMode: ExcludeMode | null = null;
  if (useGitignore) excludeMode = "gitignore";
  const excludeArg = argv.find((a) => a.startsWith("--exclude-mode="));
  if (excludeArg) {
    const mode = excludeArg.split("=")[1] as ExcludeMode;
    if (mode === "global" || mode === "local" || mode === "gitignore") excludeMode = mode;
  }
  const envExclude = process.env.TRACEBACK_EXCLUDE_MODE?.trim().toLowerCase();
  if (envExclude === "global" || envExclude === "local" || envExclude === "gitignore") {
    excludeMode = envExclude;
  }

  const targetRepoPath = filtered[2] ?? process.cwd();
  return {
    pluginInstall,
    repoOnly: repoOnly || claudeMdOnly,
    doctor,
    chainHooks,
    allRepos,
    excludeMode,
    skipClaudeMd,
    claudeMdOnly,
    targetRepoPath,
  };
}

async function promptAllRepos(defaultYes: boolean): Promise<boolean> {
  const env = process.env.TRACEBACK_SETUP_ALL_REPOS?.trim().toLowerCase();
  if (env === "true" || env === "1" || env === "yes") return true;
  if (env === "false" || env === "0" || env === "no") return false;
  if (!process.stdin.isTTY) return defaultYes;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Enable traceback for ALL repositories on this machine? [Y/n] ")).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function promptExcludeMode(defaultMode: ExcludeMode): Promise<ExcludeMode> {
  if (!process.stdin.isTTY) return defaultMode;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question("Git exclude strategy: [G]lobal exclude (default) | [L]ocal info/exclude | [T]eam gitignore: ")
    )
      .trim()
      .toLowerCase();
    if (answer === "l" || answer === "local") return "local";
    if (answer === "t" || answer === "gitignore" || answer === "team") return "gitignore";
    return "global";
  } finally {
    rl.close();
  }
}

async function promptClaudeMdOnboarding(defaultYes: boolean): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question("Also add traceback onboarding to CLAUDE.md in the current repo? [Y/n] ")
    )
      .trim()
      .toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function applyClaudeMdOnboarding(repoRoot: string, opts: SetupCliOptions): void {
  if (opts.skipClaudeMd) {
    console.log("traceback: skipping CLAUDE.md onboarding (--skip-claude-md)");
    return;
  }
  const result = mergeClaudeMdOnboarding(repoRoot, { pluginInstall: opts.pluginInstall });
  if (result.changed === "unchanged") {
    console.log(`traceback: CLAUDE.md onboarding already up to date at ${result.path}`);
  } else {
    console.log(`traceback: ${result.changed} CLAUDE.md onboarding at ${result.path}`);
  }
}

function setupRepoOnly(repoRoot: string, opts: SetupCliOptions): void {
  console.log("\n📦 Traceback per-repo setup\n");

  if (opts.claudeMdOnly) {
    applyClaudeMdOnboarding(repoRoot, opts);
    console.log("\n✅ CLAUDE.md onboarding complete.");
    return;
  }

  const excludeMode = opts.excludeMode ?? "local";
  for (const note of applyExcludeMode(excludeMode, repoRoot)) {
    console.log(`traceback: ${note}`);
  }

  setupCursorHooks(repoRoot, distDir);
  setupVsCodeHooks(repoRoot, distDir);
  setupWindsurfHooks(repoRoot, distDir);

  let hasGlobalHooks = false;
  try {
    const globalHooksPath = execFileSync("git", ["config", "--global", "core.hooksPath"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (globalHooksPath) hasGlobalHooks = true;
  } catch {
    // not set
  }

  if (!hasGlobalHooks) {
    installHook(repoRoot, distDir);
  } else {
    console.log("traceback: skipping per-repo hook installation (global hooks already configured)");
  }

  let anyFound = false;
  for (const host of HOSTS) {
    if (existsSync(join(repoRoot, host.relPath))) anyFound = true;
    mergeHostConfig(repoRoot, host, { pluginInstall: opts.pluginInstall });
  }

  applyClaudeMdOnboarding(repoRoot, opts);

  if (!anyFound) {
    console.log(
      "\n⚠️  No known host config files were detected in this repo. " +
        "Run `traceback-setup` without --repo-only for global MCP, or add MCP config manually:",
    );
    for (const host of HOSTS) {
      console.log(`\n${host.name} (${host.relPath}):`);
      printSnippet(host);
    }
  } else {
    console.log("\n✅ Per-repo traceback setup complete.");
  }
}

async function setupAllRepos(repoRoot: string, opts: SetupCliOptions): Promise<void> {
  console.log("\n📦 Traceback global setup (all repositories)\n");

  const excludeMode = opts.excludeMode ?? (await promptExcludeMode("global"));
  for (const note of applyExcludeMode(excludeMode, repoRoot)) {
    console.log(`traceback: ${note}`);
  }

  console.log("🔧 Setting up global git hooks...");
  setupGlobalHooks({ chainHooks: opts.chainHooks, packageDistDir: distDir });

  console.log("\n📍 Configuring global MCP servers...");
  mergeGlobalCursorConfig({ pluginInstall: opts.pluginInstall });
  mergeGlobalClaudeConfig({ pluginInstall: opts.pluginInstall });

  console.log("\n🎯 Setting up global Cursor hooks...");
  setupGlobalCursorHooks(distDir);

  console.log("\n📜 Installing global Cursor always-on rule...");
  installGlobalCursorRule();

  console.log("\n🎯 Setting up Claude Code integration...");
  setupClaudeCodeHooks(repoRoot, { global: true });

  console.log("\n🎯 Installing traceback skill (Cursor + Claude global)...");
  installTracebackSkills(repoRoot, distDir);

  console.log("\n🩺 Running setup doctor...");
  printDoctorReport(runSetupDoctor(repoRoot));

  if (await promptClaudeMdOnboarding(true)) {
    applyClaudeMdOnboarding(repoRoot, opts);
  }

  console.log(
    "\n✅ Global traceback setup complete!\n" +
      "  • Portable MCP: npx -y @yavdaanalytics/traceback (Cursor ~/.cursor/mcp.json, Claude ~/.claude/.mcp.json)\n" +
      "  • Global git hooks: ~/.traceback/hooks (post-commit indexing on every repo)\n" +
      "  • Global Cursor hooks: ~/.cursor/hooks.json (repo resolved from workspace_roots)\n" +
      "  • Global Cursor rule: ~/.cursor/rules/traceback.mdc (alwaysApply)\n" +
      "  • Claude Code: ~/.claude/settings.json warm-start hooks\n" +
      "  • Skills: ~/.cursor/skills/traceback and ~/.claude/skills/traceback\n" +
      "  • Per-repo host files are optional — MCP, skill, hooks, and rule work without per-repo setup\n" +
      "  • Run `traceback-setup --repo-only` in each repo to merge MCP configs and add CLAUDE.md onboarding\n",
  );
}

async function main(): Promise<void> {
  const opts = parseSetupCli(process.argv);

  if (opts.doctor) {
    let repoRoot: string | undefined;
    try {
      repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: opts.targetRepoPath,
        encoding: "utf-8",
      }).trim();
    } catch {
      repoRoot = undefined;
    }
    const report = runSetupDoctor(repoRoot);
    printDoctorReport(report);
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: opts.targetRepoPath,
    encoding: "utf-8",
  }).trim();

  if (opts.repoOnly) {
    setupRepoOnly(repoRoot, opts);
  } else {
    const allRepos = opts.allRepos ?? (await promptAllRepos(true));
    if (allRepos) {
      await setupAllRepos(repoRoot, opts);
    } else {
      console.log(
        "\nSkipping global setup.\n" +
          "Run per-repo setup from each git repository:\n" +
          "  npx traceback-setup --repo-only\n" +
          "Or re-run global setup:\n" +
          "  traceback-setup --yes-all-repos\n",
      );
    }
  }

  if (opts.pluginInstall) {
    console.log("\n📊 Telemetry (plugin default: ON)");
  } else if (!opts.claudeMdOnly) {
    console.log("\n📊 Telemetry opt-in");
  }
  if (!opts.claudeMdOnly) {
    await promptTelemetryOptIn({ defaultOptIn: opts.pluginInstall });
  }
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
