#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolveConfig } from "../config.js";
import { ingestStaleSessions } from "../ingest/indexer.js";
import { normalizePath } from "../util/paths.js";

export interface IngestCliOptions {
  repoPath: string;
  adapterId?: string;
  sessionId?: string;
}

export async function runIngest(opts: IngestCliOptions): Promise<{ ingested: number; skipped: number }> {
  const config = resolveConfig(opts.repoPath);
  return ingestStaleSessions(
    {
      dataDir: config.dataDir,
      sqlitePath: config.sqlitePath,
      repoPath: opts.repoPath,
      sessionGapMs: config.sessionGapMs,
    },
    {
      adapterId: opts.adapterId,
      projectPath: normalizePath(opts.repoPath),
      sessionId: opts.sessionId,
    },
  );
}

function parseArgs(argv: string[]): {
  repoPath?: string;
  adapterId?: string;
  sessionId?: string;
  json: boolean;
} {
  let repoPath: string | undefined;
  let adapterId: string | undefined;
  let sessionId: string | undefined;
  let json = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--repo" || arg === "--repo-path") && argv[i + 1]) {
      repoPath = argv[++i];
    } else if (arg === "--adapter-id" && argv[i + 1]) {
      adapterId = argv[++i];
    } else if (arg === "--session-id" && argv[i + 1]) {
      sessionId = argv[++i];
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { repoPath, adapterId, sessionId, json };
}

function printHelp(): void {
  console.log(`traceback-ingest — scoped session backfill for one git repo

Usage:
  traceback-ingest --repo <path> [--adapter-id <id>] [--session-id <id>] [--json]

Options:
  --repo, --repo-path   Git repository root (default: git rev-parse from cwd)
  --adapter-id          claude-code | cursor | copilot
  --session-id          Single session UUID to ingest
  --json                Print { ingested, skipped } as JSON
`);
}

export function resolveIngestRepoPath(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    }).trim();
  } catch {
    throw new Error("Pass --repo <path> or run from inside a git repository");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const repoPath = resolveIngestRepoPath(args.repoPath);
  const result = await runIngest({
    repoPath,
    adapterId: args.adapterId,
    sessionId: args.sessionId,
  });

  if (args.json) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`Ingested ${result.ingested} session(s), skipped ${result.skipped}`);
  }
}

const isMain =
  process.argv[1]?.replace(/\\/g, "/").endsWith("/cli/ingest.js") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("/src/cli/ingest.ts");

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
