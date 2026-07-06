import { join } from "node:path";
import type { SessionAdapter, SessionRef } from "../adapters/types.js";
import { availableAdapters, getAdapter } from "../adapters/registry.js";
import { embedText, embedTexts } from "../embedding/embedder.js";
import { upsertTurnEmbeddings, type TurnEmbeddingRow } from "../storage/lancedb.js";
import { getSession, upsertSession } from "../storage/sqlite.js";
import { normalizePath } from "../util/paths.js";
import { digestSession, digestTurn, extractIntent } from "./summarizer.js";

export interface IndexConfig {
  dataDir: string;
  sqlitePath: string;
}

// Lazy/on-demand incremental ingest: compares each session's file mtime
// against what's already recorded for it and only re-embeds sessions that are
// new or changed. Triggered by an MCP tool call or the git post-commit hook -
// deliberately not a background polling loop.
export async function ingestStaleSessions(
  config: IndexConfig,
  opts: { adapterId?: string; projectPath?: string } = {},
): Promise<{ ingested: number; skipped: number }> {
  const adapters: SessionAdapter[] = opts.adapterId
    ? [getAdapter(opts.adapterId)].filter((a): a is SessionAdapter => Boolean(a))
    : availableAdapters();

  let ingested = 0;
  let skipped = 0;

  for (const adapter of adapters) {
    const refs = adapter.listSessions();
    for (const ref of refs) {
      if (opts.projectPath && normalizePath(ref.projectPath) !== normalizePath(opts.projectPath)) continue;
      const existing = getSession(config.sqlitePath, ref.sessionId);
      if (existing && (existing.ended_at ?? 0) >= ref.lastModified) {
        skipped++;
        continue;
      }
      await ingestOneSession(config, adapter, ref);
      ingested++;
    }
  }

  return { ingested, skipped };
}

async function ingestOneSession(config: IndexConfig, adapter: SessionAdapter, ref: SessionRef): Promise<void> {
  const session = adapter.loadSession(ref);

  // Get existing intent or extract from first user turn
  const existingIntentVal = existingIntent(config, session.sessionId);
  const intent = existingIntentVal ?? extractIntent(session) ?? null;

  const turnDigests = session.turns
    .map((t) => ({ turn: t, text: digestTurn(t) }))
    .filter((d) => d.text.trim().length > 0);

  const vectors = await embedTexts(turnDigests.map((d) => d.text));
  const turnRows: TurnEmbeddingRow[] = turnDigests.map((d, i) => ({
    id: `${session.sessionId}:${d.turn.turnId}`,
    session_id: session.sessionId,
    adapter_id: session.adapterId,
    turn_id: d.turn.turnId,
    chunk_text: d.text,
    vector: vectors[i],
    project_path: session.projectPath,
    timestamp: d.turn.timestamp,
    kind: d.turn.toolCalls.length > 0 ? "tool_call" : "turn_summary",
  }));

  const sessionDigest = digestSession(session);
  if (sessionDigest.trim().length > 0) {
    const summaryVector = await embedText(sessionDigest);
    turnRows.push({
      id: `${session.sessionId}:summary`,
      session_id: session.sessionId,
      adapter_id: session.adapterId,
      turn_id: "summary",
      chunk_text: sessionDigest,
      vector: summaryVector,
      project_path: session.projectPath,
      timestamp: session.endedAt,
      kind: "session_summary",
    });
  }

  await upsertTurnEmbeddings(config.dataDir, turnRows);

  // upsertSession runs last, only after embeddings are durably written: if
  // embedTexts/upsertTurnEmbeddings throws (e.g. the ONNX OOM seen in
  // practice), the session's ended_at must NOT advance, so the next
  // ingestStaleSessions pass sees existing.ended_at < ref.lastModified and
  // retries this session instead of treating a partial failure as done.
  upsertSession(config.sqlitePath, {
    session_id: session.sessionId,
    adapter_id: session.adapterId,
    project_path: session.projectPath,
    git_branch: session.gitBranch ?? null,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    slug: session.slug ?? null,
    raw_path: ref.projectPath,
    intent,
  });
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
