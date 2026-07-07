import type { SessionRef } from "../adapters/types.js";
import type { IndexConfig } from "../ingest/indexer.js";
import { copyToArchive } from "./index.js";

export function archiveCopilotSession(
  config: IndexConfig,
  ref: SessionRef,
  _archiveDir: string,
  sourceKey: string,
): void {
  if (!ref.transcriptPath) return;
  copyToArchive(config, "copilot", sourceKey, ref.transcriptPath, "change-detected");
}
