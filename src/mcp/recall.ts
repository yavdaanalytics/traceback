import { embedText } from "../embedding/embedder.js";
import { searchSimilarTurns, type TurnEmbeddingRow } from "../storage/lancedb.js";
import {
  getPenaltyWeight,
  getLinksForSession,
  getCommit,
  getFilesForCommit,
  getOutcome,
  getSession,
  getSessionAttempts,
} from "../storage/sqlite.js";
import type { ConfidenceLevel } from "./labels.js";

export interface Config {
  repoPath: string;
  dataDir: string;
  sqlitePath: string;
  confidenceThreshold: number;
}

export interface SessionSearchResult extends Omit<TurnEmbeddingRow, "vector"> {
  _distance: number;
}

export interface SessionAttemptSummary {
  commit_sha: string;
  outcome: string;
  outcome_evidence: string | null;
  link_confidence: number;
}

export interface SessionWithContext extends SessionSearchResult {
  confidence: ConfidenceLevel;
  outcome: string | null;
  outcome_evidence: string | null;
  attempts: SessionAttemptSummary[];
  linkedCommits?: Array<{
    sha: string;
    message: string | null;
    outcome: string | null;
    outcome_evidence: string | null;
    filesTouched: string[];
  }>;
}

function sessionConfidence(distance: number, threshold: number): "high" | "low" {
  return distance <= threshold ? "high" : "low";
}

function buildAttempts(sqlitePath: string, sessionId: string): SessionAttemptSummary[] {
  const links = getLinksForSession(sqlitePath, sessionId);
  const linkBySha = new Map(links.map((l) => [l.sha, l.confidence]));
  const stored = getSessionAttempts(sqlitePath, sessionId);

  if (stored.length > 0) {
    return stored.map((a) => {
      const outcomeRow = getOutcome(sqlitePath, a.commit_sha);
      return {
        commit_sha: a.commit_sha,
        outcome: outcomeRow?.outcome ?? a.outcome,
        outcome_evidence: outcomeRow?.evidence ?? null,
        link_confidence: linkBySha.get(a.commit_sha) ?? 0,
      };
    });
  }

  return links.map((link) => {
    const outcomeRow = getOutcome(sqlitePath, link.sha);
    return {
      commit_sha: link.sha,
      outcome: outcomeRow?.outcome ?? "unknown",
      outcome_evidence: outcomeRow?.evidence ?? null,
      link_confidence: link.confidence,
    };
  });
}

function bestSessionOutcome(attempts: SessionAttemptSummary[]): {
  outcome: string | null;
  outcome_evidence: string | null;
} {
  if (attempts.length === 0) return { outcome: null, outcome_evidence: null };
  const last = attempts[attempts.length - 1];
  return { outcome: last.outcome, outcome_evidence: last.outcome_evidence };
}

function matchesTagsFilter(
  sqlitePath: string,
  sessionId: string,
  chunkText: string,
  tags: string,
): boolean {
  const session = getSession(sqlitePath, sessionId);
  const haystack = [session?.metadata_json, session?.embedding_text, chunkText].filter(Boolean).join("\n");
  return haystack.includes(tags);
}

function rankWithPenalty(
  raw: TurnEmbeddingRow[],
  penaltyOf: (sessionId: string) => number,
  topK: number,
): SessionSearchResult[] {
  const embeddingOnly = raw.filter((r) => r.kind === "embedding_text");
  const withPenalty = embeddingOnly.map((r) => {
    const penalty = penaltyOf(r.session_id);
    const distance = (r as unknown as { _distance?: number })._distance ?? 0;
    return { row: r, adjusted: distance + penalty };
  });
  withPenalty.sort((a, b) => a.adjusted - b.adjusted);
  return withPenalty.slice(0, topK).map((w) => {
    const { vector: _vector, ...rest } = w.row;
    return { ...rest, _distance: w.adjusted } as SessionSearchResult;
  });
}

export async function findSimilarSessions(
  config: Config,
  query: string,
  topK: number = 5,
  projectPath?: string,
): Promise<SessionSearchResult[]> {
  const vector = await embedText(query);
  const raw = await searchSimilarTurns(config.dataDir, vector, Math.max(topK, topK * 3), projectPath);
  return rankWithPenalty(raw, (sid) => getPenaltyWeight(config.sqlitePath, sid), topK);
}

export async function findSimilarSessionsWithContext(
  config: Config,
  query: string,
  topK: number = 5,
  projectPath?: string,
  filters?: { adapter_id?: string; outcome?: string; tags?: string },
): Promise<SessionWithContext[]> {
  const vector = await embedText(query);
  const raw = await searchSimilarTurns(config.dataDir, vector, Math.max(topK, topK * 3), projectPath);

  const withPenalty = raw
    .filter((r) => r.kind === "embedding_text")
    .map((r) => {
      const penalty = getPenaltyWeight(config.sqlitePath, r.session_id);
      const distance = (r as unknown as { _distance?: number })._distance ?? 0;
      return { row: r, adjusted: distance + penalty };
    });
  withPenalty.sort((a, b) => a.adjusted - b.adjusted);

  const sessionMap = new Map<string, (typeof withPenalty)[0]>();
  for (const w of withPenalty) {
    if (!sessionMap.has(w.row.session_id)) {
      sessionMap.set(w.row.session_id, w);
    }
  }

  const results: SessionWithContext[] = [];
  for (const w of Array.from(sessionMap.values()).slice(0, topK * 2)) {
    if (filters?.adapter_id && w.row.adapter_id !== filters.adapter_id) continue;
    if (filters?.tags && !matchesTagsFilter(config.sqlitePath, w.row.session_id, w.row.chunk_text, filters.tags)) {
      continue;
    }

    const attempts = buildAttempts(config.sqlitePath, w.row.session_id);
    const { outcome, outcome_evidence } = bestSessionOutcome(attempts);

    if (filters?.outcome) {
      const hasOutcome = attempts.some((a) => a.outcome === filters.outcome);
      if (!hasOutcome) continue;
    }

    const links = getLinksForSession(config.sqlitePath, w.row.session_id);
    const commits = links.map((link) => {
      const commit = getCommit(config.sqlitePath, link.sha);
      const outcomeRow = getOutcome(config.sqlitePath, link.sha);
      return {
        sha: link.sha,
        message: commit?.message ?? null,
        outcome: outcomeRow?.outcome ?? null,
        outcome_evidence: outcomeRow?.evidence ?? null,
        filesTouched: getFilesForCommit(config.sqlitePath, link.sha),
      };
    });

    const { vector: _vector, ...rest } = w.row;
    const sessionResult: SessionWithContext = {
      ...rest,
      _distance: w.adjusted,
      confidence: sessionConfidence(w.adjusted, config.confidenceThreshold),
      outcome,
      outcome_evidence,
      attempts,
    };

    if (commits.length > 0) sessionResult.linkedCommits = commits;
    results.push(sessionResult);
    if (results.length >= topK) break;
  }

  return results;
}
