#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
