import { statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionRef } from "../adapters/types.js";
import { resolveConfig, DEFAULT_CLAUDE_ARCHIVE_AGE_DAYS } from "../config.js";
import type { IndexConfig } from "../ingest/indexer.js";
import { copyToArchive } from "./index.js";

function projectsDir(): string {
  return process.env.TRACEBACK_CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
}

function desanitizeProjectDir(dirName: string): string {
  return dirName.replace(/^([a-zA-Z])--/, "$1:/").replace(/-/g, "/");
}

export function archiveClaudeSession(
  config: IndexConfig,
  ref: SessionRef,
  _archiveDir: string,
  sourceKey: string,
): void {
  const ageDays = resolveConfig(config.repoPath).claudeArchiveAgeDays ?? DEFAULT_CLAUDE_ARCHIVE_AGE_DAYS;
  const maxAgeMs = ageDays * 86_400_000;
  if (Date.now() - ref.lastModified > maxAgeMs) return;

  const transcriptPath = ref.transcriptPath;
  if (!transcriptPath) return;

  try {
    const st = statSync(transcriptPath);
    if (Date.now() - st.mtimeMs > maxAgeMs) return;
    copyToArchive(config, "claude-code", sourceKey, transcriptPath, "age-based");
  } catch {
    // non-blocking
  }
}

export { desanitizeProjectDir, projectsDir };
