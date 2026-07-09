#!/usr/bin/env node
// Reproduce the Power BI CIAM warm-start measurement on a local checkout of the
// private sibling repo (or any repo via --repo). Compares blind full-repo grep
// vs search_with_fallback scoped grep. Requires `npm run build` first.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tracebackRoot = resolve(__dirname, "..");
const fixturePath = join(tracebackRoot, "fixtures/powerbi-ciam-proof/invocation-1.json");

const QUERY = "CIAM authentication tenant isolation";
const BLIND_PATTERN = "ciam|authentication|tenant";

function parseArgs(argv) {
  let repo = process.env.TRACEBACK_PROOF_REPO ?? join(tracebackRoot, "..", "powerbi-embedded-analytics");
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--repo" && argv[i + 1]) {
      repo = resolve(argv[++i]);
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: node scripts/reproduce-powerbi-proof.mjs [--repo <path>]

  --repo   Target git repo (default: ../powerbi-embedded-analytics or TRACEBACK_PROOF_REPO)
  Requires: npm run build (uses dist/mcp/fallback.js)`);
      process.exit(0);
    }
  }
  return repo;
}

function blindGrepLines(repoPath) {
  try {
    const out = execFileSync("git", ["grep", "-i", "-E", BLIND_PATTERN], { cwd: repoPath, encoding: "utf-8" });
    const lines = out.trim().split("\n").filter(Boolean);
    return { lines: lines.length, bytes: Buffer.byteLength(out, "utf-8") };
  } catch (error) {
    const err = error;
    const out = err.stdout ?? "";
    const lines = String(out).trim().split("\n").filter(Boolean);
    return { lines: lines.length, bytes: Buffer.byteLength(String(out), "utf-8") };
  }
}

async function scopedSearch(repoPath) {
  const configUrl = new URL("../dist/config.js", import.meta.url);
  const fallbackUrl = new URL("../dist/mcp/fallback.js", import.meta.url);
  const { resolveConfig } = await import(configUrl.href);
  const { searchWithFallback } = await import(fallbackUrl.href);
  const cfg = resolveConfig(repoPath);
  const result = await searchWithFallback(cfg, { query: QUERY });
  const rawLines = result.grep_result.split("\n").filter(Boolean);
  return {
    mode: result.mode,
    rawLines: rawLines.length,
    bytes: Buffer.byteLength(result.grep_result, "utf-8"),
    gitScopeFiles: (result.git_scope ?? []).reduce((n, c) => n + c.files_changed.length, 0),
    layers: result.layers,
  };
}

function pctReduction(scoped, blind) {
  if (blind <= 0) return 0;
  return Number((((blind - scoped) / blind) * 100).toFixed(1));
}

async function main() {
  const repoPath = parseArgs(process.argv);
  const distFallback = join(tracebackRoot, "dist/mcp/fallback.js");
  if (!existsSync(distFallback)) {
    console.error("dist/ not found. Run: npm run build");
    process.exit(1);
  }
  if (!existsSync(join(repoPath, ".git"))) {
    console.error(`Not a git repo: ${repoPath}`);
    console.error("The Power BI repo is private — clone it locally or pass --repo <your-checkout>.");
    process.exit(1);
  }

  console.log(`Query: ${QUERY}`);
  console.log(`Repo:  ${repoPath}\n`);

  const blind = blindGrepLines(repoPath);
  const scoped = await scopedSearch(repoPath);
  const reduction = pctReduction(scoped.rawLines, blind.lines);

  console.log("Blind grep (full repo):");
  console.log(`  pattern: ${BLIND_PATTERN}`);
  console.log(`  lines:   ${blind.lines}`);
  console.log(`  bytes:   ${blind.bytes}`);
  console.log(`  ~tokens: ${Math.ceil(blind.bytes / 4)}`);

  console.log("\nTraceback search_with_fallback:");
  console.log(`  mode:    ${scoped.mode}`);
  console.log(`  lines:   ${scoped.rawLines} (raw scoped grep)`);
  console.log(`  bytes:   ${scoped.bytes}`);
  console.log(`  ~tokens: ${Math.ceil(scoped.bytes / 4)}`);
  console.log(`  git scope files (L2): ${scoped.gitScopeFiles}`);

  console.log(`\nLine reduction: ${reduction}%`);

  if (existsSync(fixturePath)) {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    console.log("\nPinned fixture (2026-07-08):");
    console.log(`  scoped lines: ${fixture.warm_lines_pulled}`);
    console.log(`  blind lines:  ${fixture.blind_grep.lines}`);
    console.log(`  reduction:    ${fixture.line_reduction_pct}%`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
