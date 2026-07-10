#!/usr/bin/env node
/**
 * Sync plugin package shells from setup.ts portable assets.
 * Requires `npm run build` first (imports from dist/).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function copySkill(repoRoot, pluginRoot) {
  const sourcePath = resolve(repoRoot, "SKILL.md");
  const source = readFileSync(sourcePath, "utf-8");
  const content = source.includes("<!-- traceback-skill -->")
    ? source
    : `${source.trimEnd()}\n\n<!-- traceback-skill -->\n`;
  const targetDir = resolve(pluginRoot, "skills", "traceback");
  const target = resolve(targetDir, "SKILL.md");
  ensureDir(targetDir);
  writeFileSync(target, content, "utf-8");
  process.stdout.write(`synced ${target} from repo SKILL.md\n`);
}

const repoRoot = process.cwd();
const distSetup = resolve(repoRoot, "dist", "cli", "setup.js");
if (!existsSync(distSetup)) {
  throw new Error("dist/cli/setup.js missing — run `npm run build` before release:sync-plugins");
}

const {
  renderTracebackCursorRule,
  portableCursorHooksConfig,
  portableClaudeHooksConfig,
  portablePluginMcpConfig,
  TRACEBACK_CONFIG_KEY,
} = await import(pathToFileURL(distSetup).href);

const packageJsonPath = resolve(repoRoot, "package.json");
const claudePluginRoot = resolve(repoRoot, "plugins", "claude-traceback");
const cursorPluginRoot = resolve(repoRoot, "plugins", "cursor-traceback");
const claudePluginPath = resolve(claudePluginRoot, ".claude-plugin", "plugin.json");
const cursorPluginPath = resolve(cursorPluginRoot, ".cursor-plugin", "plugin.json");

const packageJson = readJson(packageJsonPath);
if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
  throw new Error("package.json version is missing or invalid");
}

const targetVersion = packageJson.version.trim();

for (const pluginPath of [claudePluginPath, cursorPluginPath]) {
  const pluginJson = readJson(pluginPath);
  pluginJson.version = targetVersion;
  writeJson(pluginPath, pluginJson);
  process.stdout.write(`synced ${pluginPath} to version ${targetVersion}\n`);
}

for (const pluginRoot of [claudePluginRoot, cursorPluginRoot]) {
  copySkill(repoRoot, pluginRoot);
}

const mcpConfig = portablePluginMcpConfig();
for (const pluginRoot of [claudePluginRoot, cursorPluginRoot]) {
  const mcpPath = resolve(pluginRoot, "mcp.json");
  writeJson(mcpPath, mcpConfig);
  process.stdout.write(`synced ${mcpPath} from portablePluginMcpConfig\n`);
}

const cursorRulePath = resolve(cursorPluginRoot, "rules", "traceback.mdc");
ensureDir(dirname(cursorRulePath));
writeFileSync(cursorRulePath, renderTracebackCursorRule(TRACEBACK_CONFIG_KEY), "utf-8");
process.stdout.write(`synced ${cursorRulePath} from renderTracebackCursorRule\n`);

const cursorHooksPath = resolve(cursorPluginRoot, "hooks", "hooks.json");
ensureDir(dirname(cursorHooksPath));
writeJson(cursorHooksPath, portableCursorHooksConfig());
process.stdout.write(`synced ${cursorHooksPath} from portableCursorHooksConfig\n`);

const claudeHooksPath = resolve(claudePluginRoot, "hooks", "hooks.json");
ensureDir(dirname(claudeHooksPath));
writeJson(claudeHooksPath, portableClaudeHooksConfig());
process.stdout.write(`synced ${claudeHooksPath} from portableClaudeHooksConfig\n`);

const cursorManifest = readJson(cursorPluginPath);
cursorManifest.skills = "skills/";
cursorManifest.rules = "rules/";
cursorManifest.hooks = "hooks/hooks.json";
cursorManifest.mcpServers = "mcp.json";
writeJson(cursorPluginPath, cursorManifest);

const claudeManifest = readJson(claudePluginPath);
claudeManifest.skills = "skills/";
claudeManifest.hooks = "hooks/hooks.json";
claudeManifest.mcpServers = "mcp.json";
writeJson(claudePluginPath, claudeManifest);
process.stdout.write("updated plugin manifests to reference skills/rules/hooks/mcp\n");

const telemetryEnvKeys = ["TRACEBACK_TELEMETRY_OPT_IN", "TRACEBACK_TELEMETRY_ENDPOINT"];
for (const pluginRoot of [claudePluginRoot, cursorPluginRoot]) {
  const mcpPath = resolve(pluginRoot, "mcp.json");
  const mcp = readJson(mcpPath);
  const env = mcp?.mcpServers?.traceback?.env;
  if (!env) throw new Error(`missing traceback env in ${mcpPath}`);
  for (const key of telemetryEnvKeys) {
    if (env[key] === undefined) throw new Error(`${mcpPath} missing env.${key}`);
  }
}
process.stdout.write("verified plugin mcp.json telemetry env keys\n");
