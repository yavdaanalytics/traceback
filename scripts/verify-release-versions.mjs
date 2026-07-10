#!/usr/bin/env node
/**
 * Assert package.json version matches both host plugin manifests.
 *
 * Usage:
 *   node scripts/verify-release-versions.mjs
 *   node scripts/verify-release-versions.mjs --expect 0.1.3
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const repoRoot = process.cwd();
const pkg = readJson(resolve(repoRoot, "package.json"));
const claude = readJson(
  resolve(repoRoot, "plugins/claude-traceback/.claude-plugin/plugin.json"),
);
const cursor = readJson(
  resolve(repoRoot, "plugins/cursor-traceback/.cursor-plugin/plugin.json"),
);

const expected = (argValue("--expect") ?? pkg.version ?? "").trim();
if (!expected) {
  throw new Error("package.json version is missing or empty");
}

const versions = {
  npm: String(pkg.version ?? "").trim(),
  "claude-plugin": String(claude.version ?? "").trim(),
  "cursor-plugin": String(cursor.version ?? "").trim(),
};

const mismatches = Object.entries(versions).filter(([, v]) => v !== expected);
if (mismatches.length > 0) {
  const detail = mismatches.map(([name, v]) => `  ${name}=${v || "<missing>"}`).join("\n");
  throw new Error(
    `release version mismatch (expected ${expected}):\n${detail}\n` +
      `Run: npm run build && npm run release:sync-plugins && npm run release:verify-versions`,
  );
}

process.stdout.write(
  `release versions aligned at ${expected} (npm, claude-plugin, cursor-plugin)\n`,
);
