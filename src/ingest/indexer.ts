import { join } from "node:path";
import type { SessionAdapter, SessionRef } from "../adapters/types.js";
import { availableAdapters, getAdapter } from "../adapters/registry.js";
import { archiveSessionIfNeeded } from "../archiver/index.js";
import { embedText } from "../embedding/embedder.js";
import { upsertTurnEmbeddings, hasEmbeddingTextRow, type TurnEmbeddingRow } from "../storage/lancedb.js";
import { getSession, getSessionBySourceFileKey, upsertSession } from "../storage/sqlite.js";
import { normalizePath } from "../util/paths.js";
import { digestSession, extractIntent } from "./summarizer.js";
import { segmentSession } from "./segmentation.js";
import { buildSessionLinkageMetadata, metadataNeedsLinkageEnrichment } from "./session-files.js";
import { deriveSessionAttempts, linkValidatedTranscriptCommits } from "../git/commit-correlation.js";

export interface IndexConfig {
  dataDir: string;
  sqlitePath: string;
  repoPath?: string;
  sessionGapMs?: number;
}

export async function ingestStaleSessions(
  config: IndexConfig,
  opts: { adapterId?: string; projectPath?: string; sessionId?: string } = {},
): Promise<{ ingested: number; skipped: number }> {
  const adapters: SessionAdapter[] = opts.adapterId
    ? [getAdapter(opts.adapterId)].filter((a): a is SessionAdapter => Boolean(a))
    : availableAdapters();

  let ingested = 0;
  let skipped = 0;

  for (const adapter of adapters) {
    let refs: SessionRef[];
    try {
      refs = adapter.discover?.() ?? adapter.listSessions();
    } catch {
      continue;
    }
    for (const ref of refs) {
      if (opts.projectPath && normalizePath(ref.projectPath) !== normalizePath(opts.projectPath)) continue;
      if (opts.sessionId && ref.sessionId !== opts.sessionId && !ref.sessionId.startsWith(`${opts.sessionId}:`)) continue;

      const existing = getSessionBySourceFileKey(config.sqlitePath, `${adapter.id}:${ref.sessionId}:seg-0`) ??
        getSession(config.sqlitePath, ref.sessionId);

      const needsReindex =
        !existing ||
        (existing.ended_at ?? 0) < ref.lastModified ||
        !existing.embedding_text ||
        metadataNeedsLinkageEnrichment(existing.metadata_json) ||
        !(await hasEmbeddingTextRow(config.dataDir, existing.session_id));

      if (!needsReindex) {
        skipped++;
        continue;
      }

      try {
        archiveSessionIfNeeded(config, adapter.id, ref);
      } catch {
        // non-blocking
      }

      try {
        await ingestOneRef(config, adapter, ref);
        ingested++;
      } catch {
        // non-blocking per session
      }
    }
  }

  return { ingested, skipped };
}

async function ingestOneRef(config: IndexConfig, adapter: SessionAdapter, ref: SessionRef): Promise<void> {
  const normalized = (adapter.parse?.(ref) ?? adapter.loadSession(ref)) as import("../adapters/types.js").NormalizedSession;
  const segments = segmentSession(normalized, {
    transcriptRef: normalized.transcriptRef,
    sourceFileKey: `${adapter.id}:${ref.sessionId}`,
    metadata: normalized.metadata,
    gapMs: config.sessionGapMs,
  });

  for (const segment of segments) {
    await ingestOneSegment(config, segment);
  }
}

async function ingestOneSegment(
  config: IndexConfig,
  session: ReturnType<typeof segmentSession>[number],
): Promise<void> {
  const existingIntentVal = existingIntent(config, session.sessionId);
  const intent = existingIntentVal ?? extractIntent(session) ?? null;
  const embeddingText = digestSession(session);
  const repoPath = config.repoPath ?? session.projectPath;
  const linkageMeta = buildSessionLinkageMetadata(session, session.metadata, repoPath);

  if (embeddingText.trim().length > 0) {
    const vector = await embedText(embeddingText);
    const row: TurnEmbeddingRow = {
      id: `${session.sessionId}:embedding_text`,
      session_id: session.sessionId,
      adapter_id: session.adapterId,
      turn_id: "embedding_text",
      chunk_text: embeddingText,
      vector,
      project_path: session.projectPath,
      timestamp: session.endedAt,
      kind: "embedding_text",
    };
    await upsertTurnEmbeddings(config.dataDir, [row]);
  }

  const now = Date.now();
  upsertSession(config.sqlitePath, {
    session_id: session.sessionId,
    adapter_id: session.adapterId,
    project_path: session.projectPath,
    git_branch: session.gitBranch ?? null,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    slug: session.slug ?? null,
    raw_path: session.transcriptRef,
    intent,
    transcript_ref: session.transcriptRef,
    segment_index: session.segmentIndex,
    source_file_key: session.sourceFileKey,
    metadata_json: JSON.stringify(linkageMeta),
    embedding_text: embeddingText,
    indexed_at: now,
  });

  if (repoPath) {
    try {
      linkValidatedTranscriptCommits(config.sqlitePath, repoPath, session.sessionId, linkageMeta.commitHashes);
      deriveSessionAttempts(config.sqlitePath, repoPath, session.sessionId);
    } catch {
      // non-blocking
    }
  }
}

function existingIntent(config: IndexConfig, sessionId: string): string | null {
  const existing = getSession(config.sqlitePath, sessionId);
  return existing?.intent ?? null;
}

export function defaultDataDir(repoRoot: string): string {
  return join(repoRoot, "data", "lancedb");
}

export function defaultSqlitePath(repoRoot: string): string {
  return join(repoRoot, "data", "traceback.db");
}
