import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SessionRef } from "../adapters/types.js";
import type { IndexConfig } from "../ingest/indexer.js";
import { getArchiveRecord, upsertArchiveRecord } from "../storage/sqlite.js";
import { archiveClaudeSession } from "./claude.js";
import { archiveCursorSession } from "./cursor.js";
import { archiveCopilotSession } from "./copilot.js";

export function archiveSessionIfNeeded(config: IndexConfig, adapterId: string, ref: SessionRef): void {
  const archiveDir = join(config.repoPath ?? process.cwd(), "data", "archive");
  const sourceKey = `${ref.sessionId}`;

  if (adapterId === "claude-code") {
    archiveClaudeSession(config, ref, archiveDir, sourceKey);
    return;
  }
  if (adapterId === "cursor") {
    archiveCursorSession(config, ref, archiveDir, sourceKey);
    return;
  }
  if (adapterId === "copilot") {
    archiveCopilotSession(config, ref, archiveDir, sourceKey);
  }
}

export function copyToArchive(
  config: IndexConfig,
  adapterId: string,
  sourceKey: string,
  sourcePath: string,
  trigger: string,
): string | undefined {
  if (!existsSync(sourcePath)) return undefined;
  const existing = getArchiveRecord(config.sqlitePath, adapterId, sourceKey);
  if (existing && existsSync(existing.archive_path)) return existing.archive_path;

  const destDir = join(config.repoPath ?? process.cwd(), "data", "archive", adapterId);
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, `${sourceKey.replace(/[/\\:]/g, "_")}.archive`);
  copyFileSync(sourcePath, destPath);
  upsertArchiveRecord(config.sqlitePath, {
    adapter_id: adapterId,
    source_key: sourceKey,
    archived_at: Date.now(),
    archive_path: destPath,
    trigger,
  });
  return destPath;
}

export function writeJsonArchive(
  config: IndexConfig,
  adapterId: string,
  sourceKey: string,
  data: unknown,
  trigger: string,
): string {
  const destDir = join(config.repoPath ?? process.cwd(), "data", "archive", adapterId);
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, `${sourceKey.replace(/[/\\:]/g, "_")}.json`);
  writeFileSync(destPath, JSON.stringify(data, null, 2));
  upsertArchiveRecord(config.sqlitePath, {
    adapter_id: adapterId,
    source_key: sourceKey,
    archived_at: Date.now(),
    archive_path: destPath,
    trigger,
  });
  return destPath;
}

export function readArchiveIfExists(adapterId: string, sourceKey: string, sqlitePath: string): string | undefined {
  const rec = getArchiveRecord(sqlitePath, adapterId, sourceKey);
  if (!rec || !existsSync(rec.archive_path)) return undefined;
  return readFileSync(rec.archive_path, "utf-8");
}
