import { defaultDataDir, defaultSqlitePath } from "./ingest/indexer.js";

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.35;
export const DEFAULT_SESSION_GAP_MS = 30 * 60 * 1000;
export const DEFAULT_COMMIT_WINDOW_MS = 30 * 60 * 1000;
export const DEFAULT_CLAUDE_ARCHIVE_AGE_DAYS = 7;
export const DEFAULT_KEYWORD_ROUTER_ENABLED = true;
export const DEFAULT_KEYWORD_STRONG_THRESHOLD = 2.2;
export const DEFAULT_KEYWORD_WEAK_THRESHOLD = 0.8;

export function resolveConfig(repoPath: string = process.cwd()): {
  repoPath: string;
  dataDir: string;
  sqlitePath: string;
  confidenceThreshold: number;
  sessionGapMs: number;
  commitWindowMs: number;
  claudeArchiveAgeDays: number;
  keywordRouterEnabled: boolean;
  keywordStrongThreshold: number;
  keywordWeakThreshold: number;
} {
  return {
    repoPath,
    dataDir: defaultDataDir(repoPath),
    sqlitePath: defaultSqlitePath(repoPath),
    confidenceThreshold: Number(process.env.TRACEBACK_CONFIDENCE_THRESHOLD ?? String(DEFAULT_CONFIDENCE_THRESHOLD)),
    sessionGapMs: Number(process.env.TRACEBACK_SESSION_GAP_MS ?? String(DEFAULT_SESSION_GAP_MS)),
    commitWindowMs: Number(process.env.TRACEBACK_COMMIT_WINDOW_MS ?? String(DEFAULT_COMMIT_WINDOW_MS)),
    claudeArchiveAgeDays: Number(
      process.env.TRACEBACK_CLAUDE_ARCHIVE_AGE_DAYS ?? String(DEFAULT_CLAUDE_ARCHIVE_AGE_DAYS),
    ),
    keywordRouterEnabled: (process.env.TRACEBACK_KEYWORD_ROUTER ?? String(DEFAULT_KEYWORD_ROUTER_ENABLED)) === "true",
    keywordStrongThreshold: Number(
      process.env.TRACEBACK_KEYWORD_STRONG_THRESHOLD ?? String(DEFAULT_KEYWORD_STRONG_THRESHOLD),
    ),
    keywordWeakThreshold: Number(process.env.TRACEBACK_KEYWORD_WEAK_THRESHOLD ?? String(DEFAULT_KEYWORD_WEAK_THRESHOLD)),
  };
}
