#!/usr/bin/env node
/**
 * Opt-in Phase 1 E2E check against real ~/.claude history.
 * Does not run in CI unless TRACEBACK_E2E=1 is set.
 *
 * Usage:
 *   npm run build
 *   TRACEBACK_E2E=1 node scripts/phase1-e2e.mjs --repo c:/source/traceback --query "authentication token"
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ingestStaleSessions, defaultDataDir, defaultSqlitePath } from "../dist/ingest/indexer.js";
import { findSimilarSessionsWithContext } from "../dist/mcp/recall.js";
import { resolveConfig } from "../dist/config.js";
import { normalizePath } from "../dist/util/paths.js";

function parseArgs(argv) {
  let repoPath = process.cwd();
  let query = "authentication token";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--repo" && argv[i + 1]) repoPath = argv[++i];
    else if (argv[i] === "--query" && argv[i + 1]) query = argv[++i];
  }
  return { repoPath, query };
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

async function main() {
  if (process.env.TRACEBACK_E2E !== "1") {
    console.log("Skip: set TRACEBACK_E2E=1 to run Phase 1 real-data verification.");
    process.exit(0);
  }

  const claudeDir = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeDir)) {
    fail(`No Claude Code history at ${claudeDir}`);
  }

  const { repoPath, query } = parseArgs(process.argv);
  const config = resolveConfig(repoPath);
  const normalizedRepo = normalizePath(repoPath);

  console.log(`Phase 1 E2E — repo=${repoPath} query="${query}"`);

  const ingest = await ingestStaleSessions(
    {
      dataDir: config.dataDir,
      sqlitePath: config.sqlitePath,
      repoPath,
      sessionGapMs: config.sessionGapMs,
    },
    { projectPath: normalizedRepo },
  );
  console.log(`Ingested ${ingest.ingested} session(s), skipped ${ingest.skipped}`);

  const results = await findSimilarSessionsWithContext(
    config,
    query,
    5,
    normalizedRepo,
  );

  if (results.length === 0) {
    fail(`search_dev_history returned zero matches for "${query}"`);
  }
  pass(`${results.length} session match(es)`);

  const top = results[0];
  if (top.confidence !== "high" && top.confidence !== "low") {
    fail(`top match confidence must be high|low, got ${top.confidence}`);
  }
  pass(`top match confidence=${top.confidence} (_distance=${top._distance.toFixed(4)})`);

  const hasCommit =
    (top.linkedCommits?.length ?? 0) > 0 ||
    top.attempts.some((a) => a.commit_sha);
  if (!hasCommit) {
    fail("top match has no linked commit — run a commit during a Claude session or install global hook");
  }
  pass("top match has linked commit(s)");

  const sha = top.linkedCommits?.[0]?.sha ?? top.attempts[0]?.commit_sha;
  if (sha) {
    try {
      execFileSync("git", ["cat-file", "-e", sha], { cwd: repoPath, stdio: "ignore" });
      pass(`commit ${sha.slice(0, 12)} exists in repo`);
    } catch {
      fail(`linked commit ${sha} not found in ${repoPath}`);
    }
  }

  if (!("outcome" in top)) fail("missing outcome on session match");
  if (!("outcome_evidence" in top)) fail("missing outcome_evidence on session match");
  pass(`outcome=${top.outcome ?? "null"} evidence=${top.outcome_evidence ? "present" : "null"}`);

  console.log("\nPhase 1 E2E verification complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
