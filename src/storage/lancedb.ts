import * as lancedb from "@lancedb/lancedb";
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
  kind: "turn_summary" | "tool_call" | "session_summary";
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
  let query = table.search(queryVector).limit(topK);
  if (projectPath) {
    // project_path values come from different session adapters (native OS
    // separators/casing) - normalize both sides the same way normalizePath()
    // does elsewhere in the ingest pipeline, so a caller passing "C:\foo"
    // still matches a row stored as "c:/foo".
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
  return (await table.search(queryVector).limit(topK).toArray()) as unknown as CommitEmbeddingRow[];
}
