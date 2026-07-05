import { embedText } from "../embedding/embedder.js";
import { searchSimilarTurns, type TurnEmbeddingRow } from "../storage/lancedb.js";
import { getPenaltyWeight, getLinksForSession, getCommit, getFilesForCommit, getSession } from "../storage/sqlite.js";

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

// Extracted from the find_similar_sessions handler in index.ts.
// Embeds query, searches vector DB, applies penalty weights, and returns top-k results.
export async function findSimilarSessions(
  config: Config,
  query: string,
  topK: number = 5,
  projectPath?: string,
): Promise<SessionSearchResult[]> {
  const vector = await embedText(query);
  // Over-fetch so penalty re-sort has room to promote unpenalized results
  const raw = await searchSimilarTurns(config.dataDir, vector, Math.max(topK, topK * 3), projectPath);

  // LanceDB's default metric is ascending L2 distance (_distance, lower = more similar).
  // Penalizing a session means ADDING its penalty_weight to _distance.
  const withPenalty = raw.map((r) => {
    const penalty = getPenaltyWeight(config.sqlitePath, r.session_id);
    const distance = (r as unknown as { _distance?: number })._distance ?? 0;
    return { row: r, adjusted: distance + penalty };
  });
  withPenalty.sort((a, b) => a.adjusted - b.adjusted);
  const results = withPenalty.slice(0, topK).map((w) => {
    const { vector: _vector, ...rest } = w.row;
    return { ...rest, _distance: w.adjusted } as SessionSearchResult;
  });

  return results;
}

// Enhanced version that includes linked commit context for better answer generation
export async function findSimilarSessionsWithContext(
  config: Config,
  query: string,
  topK: number = 5,
  projectPath?: string,
): Promise<SessionWithContext[]> {
  const vector = await embedText(query);
  const raw = await searchSimilarTurns(config.dataDir, vector, Math.max(topK, topK * 3), projectPath);

  const withPenalty = raw.map((r) => {
    const penalty = getPenaltyWeight(config.sqlitePath, r.session_id);
    const distance = (r as unknown as { _distance?: number })._distance ?? 0;
    return { row: r, adjusted: distance + penalty };
  });
  withPenalty.sort((a, b) => a.adjusted - b.adjusted);

  // Deduplicate by session_id and get unique sessions
  const sessionMap = new Map<string, typeof withPenalty[0]>();
  for (const w of withPenalty) {
    if (!sessionMap.has(w.row.session_id)) {
      sessionMap.set(w.row.session_id, w);
    }
  }

  const results: SessionWithContext[] = [];
  for (const w of Array.from(sessionMap.values()).slice(0, topK)) {
    const { vector: _vector, ...rest } = w.row;
    const sessionResult: SessionWithContext = { ...rest, _distance: w.adjusted };

    // Add linked commits with their messages and files
    const links = getLinksForSession(config.sqlitePath, w.row.session_id);
    const commits = links.map((link) => {
      const commit = getCommit(config.sqlitePath, link.sha);
      return {
        sha: link.sha,
        message: commit?.message ?? null,
        filesTouched: getFilesForCommit(config.sqlitePath, link.sha),
      };
    });

    if (commits.length > 0) {
      sessionResult.linkedCommits = commits;
    }

    results.push(sessionResult);
  }

  return results;
}
