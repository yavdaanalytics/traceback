import { defaultDataDir, defaultSqlitePath } from "./ingest/indexer.js";

// The MCP server is expected to be launched with cwd set to the repo it's
// indexing (per-repo install model, matching the git hook's own per-repo
// installation - no global/multi-repo config in v1).
export function resolveConfig(repoPath: string = process.cwd()): {
  repoPath: string;
  dataDir: string;
  sqlitePath: string;
  confidenceThreshold: number;
} {
  return {
    repoPath,
    dataDir: defaultDataDir(repoPath),
    sqlitePath: defaultSqlitePath(repoPath),
    confidenceThreshold: Number(process.env.TRACEBACK_CONFIDENCE_THRESHOLD ?? "2.0"),
  };
}
