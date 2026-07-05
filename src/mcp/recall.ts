import { embedText } from "../embedding/embedder.js";
import { searchSimilarTurns, type TurnEmbeddingRow } from "../storage/lancedb.js";
import { getPenaltyWeight } from "../storage/sqlite.js";

export interface Config {
  repoPath: string;
  dataDir: string;
  sqlitePath: string;
  confidenceThreshold: number;
}

export interface SessionSearchResult extends Omit<TurnEmbeddingRow, "vector"> {
  _distance: number;
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
