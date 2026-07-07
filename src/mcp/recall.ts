import { embedText } from "../embedding/embedder.js";
import { searchSimilarTurns, type TurnEmbeddingRow } from "../storage/lancedb.js";
import { getPenaltyWeight, getLinksForSession, getCommit, getFilesForCommit, getOutcome } from "../storage/sqlite.js";

export interface Config {
  repoPath: string;
  dataDir: string;
  sqlitePath: string;
  confidenceThreshold: number;
}

export interface SessionSearchResult extends Omit<TurnEmbeddingRow, "vector"> {
  _distance: number;
}

export interface SessionWithContext extends SessionSearchResult {
  linkedCommits?: Array<{
    sha: string;
    message: string | null;
    filesTouched: string[];
  }>;
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
  filters?: { adapter_id?: string; outcome?: string },
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

    const { vector: _vector, ...rest } = w.row;
    const sessionResult: SessionWithContext = { ...rest, _distance: w.adjusted };

    const links = getLinksForSession(config.sqlitePath, w.row.session_id);
    const commits = links.map((link) => {
      const commit = getCommit(config.sqlitePath, link.sha);
      return {
        sha: link.sha,
        message: commit?.message ?? null,
        filesTouched: getFilesForCommit(config.sqlitePath, link.sha),
      };
    });

    if (filters?.outcome) {
      const hasOutcome = links.some((l) => getOutcome(config.sqlitePath, l.sha)?.outcome === filters.outcome);
      if (!hasOutcome) continue;
    }

    if (commits.length > 0) sessionResult.linkedCommits = commits;
    results.push(sessionResult);
    if (results.length >= topK) break;
  }

  return results;
}
