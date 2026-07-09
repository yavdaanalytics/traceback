import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { availableAdapters } from "../adapters/registry.js";
import { defaultDataDir, defaultSqlitePath, ingestStaleSessions } from "../ingest/indexer.js";
import { normalizePath } from "../util/paths.js";
import { getHeadSha } from "./commit-window.js";
import { linkSessionToCommit } from "./linkage.js";
import { ensureRepoInfoExclude } from "../cli/git-excludes.js";

const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

function logFailure(repoPath: string, error: unknown): void {
  try {
    const logPath = join(repoPath, ".git", "traceback-hook.log");
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `[${new Date().toISOString()}] ${String(error)}\n`);
  } catch {
    // Never let logging failures surface either.
  }
}

// Called by the installed post-commit hook. Must never throw or block the
// commit - all failures are caught and logged, and the function always
// resolves. Finds the most-recently-active session for this repo (by session
// file mtime within ACTIVE_WINDOW_MS) and links it to the new HEAD commit
// with a confidence heuristic: high if exactly one candidate, lower if
// several equally-recent sessions are ambiguous.
export async function runPostCommitHook(repoPath: string): Promise<void> {
  try {
    ensureRepoInfoExclude(repoPath);
    const config = { dataDir: defaultDataDir(repoPath), sqlitePath: defaultSqlitePath(repoPath) };
    const normalizedRepoPath = normalizePath(repoPath);
    await ingestStaleSessions(config, { projectPath: normalizedRepoPath });

    const now = Date.now();
    const candidates = availableAdapters()
      .flatMap((adapter) => adapter.listSessions(now - ACTIVE_WINDOW_MS))
      .filter((ref) => normalizePath(ref.projectPath) === normalizedRepoPath)
      .sort((a, b) => b.lastModified - a.lastModified);

    if (candidates.length === 0) return;

    const sha = getHeadSha(repoPath);
    const mostRecent = candidates[0];
    const confidence = candidates.length === 1 ? 0.9 : 0.5;
    linkSessionToCommit(config.sqlitePath, repoPath, mostRecent.sessionId, sha, "hook", confidence);
  } catch (error) {
    logFailure(repoPath, error);
  }
}
