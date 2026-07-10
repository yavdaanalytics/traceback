import { statSync } from "node:fs";
import type { SessionRef } from "../adapters/types.js";
import { claudeProjectsDir, decodeClaudeProjectDir } from "../adapters/path-encoding.js";
import { resolveConfig, DEFAULT_CLAUDE_ARCHIVE_AGE_DAYS } from "../config.js";
import type { IndexConfig } from "../ingest/indexer.js";
import { copyToArchive } from "./index.js";

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

export { decodeClaudeProjectDir, claudeProjectsDir as projectsDir };
