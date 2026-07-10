#!/usr/bin/env node
/**
 * Verify (and optionally wait for) a package version on the npm registry.
 *
 * Usage:
 *   node scripts/ensure-npm-published.mjs
 *   node scripts/ensure-npm-published.mjs --package @yavdaanalytics/traceback --version 0.1.0
 *   node scripts/ensure-npm-published.mjs --wait --timeout-ms 120000
 *
 * Exit 0 if present, 1 if missing/timeout. Prints a machine-readable JSON line.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function argValue(flag, fallback = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const pkgJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8"));
const name = argValue("--package", pkgJson.name);
const version = argValue("--version", pkgJson.version);
const wait = process.argv.includes("--wait");
const timeoutMs = Number(argValue("--timeout-ms", "90000"));
const pollMs = Number(argValue("--poll-ms", "5000"));

function registryUrl(pkgName, pkgVersion) {
  // scoped packages use @scope%2fname in the registry path
  const pathName = pkgName.startsWith("@")
    ? `${pkgName.replace("/", "%2f")}/${pkgVersion}`
    : `${pkgName}/${pkgVersion}`;
  return `https://registry.npmjs.org/${pathName}`;
}

async function fetchPublishedVersion() {
  const url = registryUrl(name, version);
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`registry ${res.status} for ${url}`);
  }
  const body = await res.json();
  return typeof body.version === "string" ? body.version : null;
}

const started = Date.now();
let found = await fetchPublishedVersion();

while (!found && wait && Date.now() - started < timeoutMs) {
  process.stderr.write(`waiting for ${name}@${version} on registry...\n`);
  await new Promise((r) => setTimeout(r, pollMs));
  found = await fetchPublishedVersion();
}

const result = {
  ok: found === version,
  name,
  version,
  found,
  elapsed_ms: Date.now() - started,
};

process.stdout.write(`${JSON.stringify(result)}\n`);

if (!result.ok) {
  process.stderr.write(
    [
      `${name}@${version} is not on the npm registry.`,
      "Programmatic recovery:",
      "  1. Fix CI (tests must pass before publish).",
      "  2. Push the fix to the default branch.",
      "  3. Move the release tag to the fixed SHA and re-push it:",
      "       git tag -f v<version> <fixed-sha>",
      "       git push origin :refs/tags/v<version>",
      "       git push origin v<version>",
      "  4. Or: gh workflow run release-tag.yml --ref v<version>  (only after the tag points at the fix).",
      "  5. Re-check: npm run release:ensure-published -- --wait",
    ].join("\n") + "\n",
  );
  process.exit(1);
}
