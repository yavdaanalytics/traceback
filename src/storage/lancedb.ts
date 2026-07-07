import * as lancedb from "@lancedb/lancedb";
import type { VectorQuery } from "@lancedb/lancedb";
import { normalizePath } from "../util/paths.js";

export interface TurnEmbeddingRow {
  [key: string]: unknown;
  id: string;
  session_id: string;
  adapter_id: string;
  turn_id: string;
  chunk_text: string;
  vector: number[];
  project_path: string;
  timestamp: number;
  kind: "embedding_text";
}

export interface CommitEmbeddingRow {
  [key: string]: unknown;
  id: string;
  commit_sha: string;
  session_id: string | null;
  repo_path: string;
  message: string;
  files_changed_summary: string;
  vector: number[];
  timestamp: number;
}

const TURN_TABLE = "turn_embeddings";
const COMMIT_TABLE = "commit_embeddings";

let connCache: lancedb.Connection | undefined;

async function getConnection(dataDir: string): Promise<lancedb.Connection> {
  if (connCache) return connCache;
  connCache = await lancedb.connect(dataDir);
  return connCache;
}

async function ensureTable<T extends Record<string, unknown>>(
  conn: lancedb.Connection,
  name: string,
  sampleRow: T,
): Promise<lancedb.Table> {
  const existing = await conn.tableNames();
  if (existing.includes(name)) return conn.openTable(name);
  return conn.createTable(name, [sampleRow]);
}

/** Shared vector search with cosine distance (ascending _distance, lower = more similar). */
async function vectorSearch<T extends Record<string, unknown>>(
  table: lancedb.Table,
  vector: number[],
  topK: number,
): Promise<T[]> {
  const results = await (table.search(vector) as VectorQuery).distanceType("cosine").limit(topK).toArray();
  return results as unknown as T[];
}

export async function upsertTurnEmbeddings(dataDir: string, rows: TurnEmbeddingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const conn = await getConnection(dataDir);
  const table = await ensureTable(conn, TURN_TABLE, rows[0]);
  await table.mergeInsert("id").whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows);
}

export async function upsertCommitEmbeddings(
  dataDir: string,
  rows: CommitEmbeddingRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const conn = await getConnection(dataDir);
  const table = await ensureTable(conn, COMMIT_TABLE, rows[0]);
  await table.mergeInsert("id").whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows);
}

export async function searchSimilarTurns(
  dataDir: string,
  queryVector: number[],
  topK: number,
  projectPath?: string,
): Promise<TurnEmbeddingRow[]> {
  const conn = await getConnection(dataDir);
  const existing = await conn.tableNames();
  if (!existing.includes(TURN_TABLE)) return [];
  const table = await conn.openTable(TURN_TABLE);
  let query = (table.search(queryVector) as VectorQuery).distanceType("cosine").limit(topK);
  if (projectPath) {
    const normalized = normalizePath(projectPath).replace(/'/g, "''");
    query = query.where(`LOWER(REPLACE(project_path, '\\', '/')) = '${normalized}'`);
  }
  return (await query.toArray()) as unknown as TurnEmbeddingRow[];
}

export async function searchSimilarCommits(
  dataDir: string,
  queryVector: number[],
  topK: number,
): Promise<CommitEmbeddingRow[]> {
  const conn = await getConnection(dataDir);
  const existing = await conn.tableNames();
  if (!existing.includes(COMMIT_TABLE)) return [];
  const table = await conn.openTable(COMMIT_TABLE);
  return vectorSearch<CommitEmbeddingRow>(table, queryVector, topK);
}

export async function hasEmbeddingTextRow(dataDir: string, sessionId: string): Promise<boolean> {
  const conn = await getConnection(dataDir);
  const existing = await conn.tableNames();
  if (!existing.includes(TURN_TABLE)) return false;
  const table = await conn.openTable(TURN_TABLE);
  const escaped = sessionId.replace(/'/g, "''");
  const rows = await table.query().where(`session_id = '${escaped}' AND kind = 'embedding_text'`).limit(1).toArray();
  return rows.length > 0;
}
