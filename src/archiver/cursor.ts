import type { SessionRef } from "../adapters/types.js";
import type { IndexConfig } from "../ingest/indexer.js";
import { writeJsonArchive } from "./index.js";

export function archiveCursorSession(
  config: IndexConfig,
  ref: SessionRef,
  _archiveDir: string,
  sourceKey: string,
): void {
  if (!ref.transcriptPath) return;
  writeJsonArchive(
    config,
    "cursor",
    sourceKey,
    { sessionId: ref.sessionId, projectPath: ref.projectPath, transcriptPath: ref.transcriptPath },
    "change-detected",
  );
}
