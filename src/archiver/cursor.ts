import type { SessionRef } from "../adapters/types.js";
import type { IndexConfig } from "../ingest/indexer.js";
import { copyToArchive, writeJsonArchive } from "./index.js";

export function archiveCursorSession(
  config: IndexConfig,
  ref: SessionRef,
  _archiveDir: string,
  sourceKey: string,
): void {
  if (!ref.transcriptPath) return;
  if (ref.transcriptPath.endsWith(".jsonl")) {
    copyToArchive(config, "cursor", sourceKey, ref.transcriptPath, "change-detected");
    return;
  }
  writeJsonArchive(
    config,
    "cursor",
    sourceKey,
    { sessionId: ref.sessionId, projectPath: ref.projectPath, transcriptPath: ref.transcriptPath },
    "change-detected",
  );
}
