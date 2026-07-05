import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  git_branch TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  slug TEXT,
  raw_path TEXT NOT NULL,
  intent TEXT
);

CREATE TABLE IF NOT EXISTS commits (
  sha TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  author_date INTEGER,
  message TEXT,
  parent_sha TEXT
);

CREATE TABLE IF NOT EXISTS session_commit_links (
  session_id TEXT NOT NULL,
  sha TEXT NOT NULL,
  link_source TEXT NOT NULL CHECK (link_source IN ('hook','manual')),
  linked_at INTEGER NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (session_id, sha)
);

CREATE TABLE IF NOT EXISTS commit_relations (
  sha TEXT NOT NULL,
  related_sha TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('reverts','reverted_by','fixes','follows','supersedes','superseded_by')),
  PRIMARY KEY (sha, related_sha, relation)
);

CREATE TABLE IF NOT EXISTS commit_outcomes (
  sha TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('kept','reverted','broke_build','superseded','unknown')),
  derived_at INTEGER,
  evidence TEXT
);

CREATE TABLE IF NOT EXISTS files_touched (
  sha TEXT NOT NULL,
  file_path TEXT NOT NULL,
  change_type TEXT,
  PRIMARY KEY (sha, file_path)
);

CREATE TABLE IF NOT EXISTS docs_touched (
  ref_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  PRIMARY KEY (ref_id, file_path)
);

CREATE TABLE IF NOT EXISTS tool_invocations (
  invocation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  mcp_method_name TEXT NOT NULL,
  input_args TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  duration_ms REAL NOT NULL,
  ok INTEGER NOT NULL,
  error_message TEXT,
  git_depth_days REAL,
  matched_ref TEXT,
  delta_window_scale INTEGER,
  warm_lines_pulled INTEGER,
  global_lines_skipped INTEGER,
  baseline_lines INTEGER
);

CREATE TABLE IF NOT EXISTS feedback (
  feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
  invocation_id INTEGER,
  session_id TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('confirm','reject')),
  note TEXT,
  created_at INTEGER NOT NULL
);
`;

// CREATE TABLE IF NOT EXISTS can't add a column to an already-existing table,
// so sessions.penalty_weight (added after the initial schema) needs a guarded
// ALTER TABLE, idempotent and safe to run on every open.
function ensurePenaltyWeightColumn(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "penalty_weight")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN penalty_weight REAL NOT NULL DEFAULT 0`);
  }
}

// Search mode column (added for Phase 2 fallback routing eval signal).
function ensureSearchModeColumn(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(tool_invocations)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "search_mode")) {
    db.exec(`ALTER TABLE tool_invocations ADD COLUMN search_mode TEXT`);
  }
}

// Uses Node's built-in node:sqlite (stable enough on this Node version, see
// build note below) instead of better-sqlite3: better-sqlite3 ships prebuilt
// native binaries per Node ABI/platform and has none published yet for this
// Node version, falling back to node-gyp, which requires a C++ toolchain
// (Visual Studio Build Tools on Windows) not present on this machine. Using
// the runtime's own SQLite avoids that native-binary install friction
// entirely - it ships with Node, zero extra install.
const dbHandles = new Map<string, DatabaseSync>();

export function getDb(dbPath: string): DatabaseSync {
  const key = resolve(dbPath);
  const existing = dbHandles.get(key);
  if (existing) return existing;
  const dir = dirname(key);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(key);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  ensurePenaltyWeightColumn(db);
  ensureSearchModeColumn(db);
  dbHandles.set(key, db);
  return db;
}

export interface SessionRow {
  session_id: string;
  adapter_id: string;
  project_path: string;
  git_branch: string | null;
  started_at: number | null;
  ended_at: number | null;
  slug: string | null;
  raw_path: string;
  intent: string | null;
  penalty_weight?: number;
}

export function upsertSession(dbPath: string, row: SessionRow): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO sessions (session_id, adapter_id, project_path, git_branch, started_at, ended_at, slug, raw_path, intent)
       VALUES ($session_id, $adapter_id, $project_path, $git_branch, $started_at, $ended_at, $slug, $raw_path, $intent)
       ON CONFLICT(session_id) DO UPDATE SET
         adapter_id=excluded.adapter_id, project_path=excluded.project_path, git_branch=excluded.git_branch,
         started_at=excluded.started_at, ended_at=excluded.ended_at, slug=excluded.slug, raw_path=excluded.raw_path`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export function getSession(dbPath: string, sessionId: string): SessionRow | undefined {
  return getDb(dbPath)
    .prepare(`SELECT * FROM sessions WHERE session_id = $session_id`)
    .get({ session_id: sessionId }) as SessionRow | undefined;
}

export function upsertCommit(
  dbPath: string,
  row: { sha: string; repo_path: string; author_date: number; message: string; parent_sha: string | null },
): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO commits (sha, repo_path, author_date, message, parent_sha)
       VALUES ($sha, $repo_path, $author_date, $message, $parent_sha)
       ON CONFLICT(sha) DO NOTHING`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export function linkSessionCommit(
  dbPath: string,
  row: { session_id: string; sha: string; link_source: "hook" | "manual"; linked_at: number; confidence: number },
): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO session_commit_links (session_id, sha, link_source, linked_at, confidence)
       VALUES ($session_id, $sha, $link_source, $linked_at, $confidence)
       ON CONFLICT(session_id, sha) DO UPDATE SET
         link_source=excluded.link_source, linked_at=excluded.linked_at, confidence=excluded.confidence`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export function getLinksForSession(
  dbPath: string,
  sessionId: string,
): Array<{ sha: string; link_source: string; confidence: number }> {
  return getDb(dbPath)
    .prepare(`SELECT sha, link_source, confidence FROM session_commit_links WHERE session_id = $session_id`)
    .all({ session_id: sessionId }) as Array<{ sha: string; link_source: string; confidence: number }>;
}

export function getLinksForCommit(
  dbPath: string,
  sha: string,
): Array<{ session_id: string; link_source: string; confidence: number }> {
  return getDb(dbPath)
    .prepare(`SELECT session_id, link_source, confidence FROM session_commit_links WHERE sha = $sha`)
    .all({ sha }) as Array<{ session_id: string; link_source: string; confidence: number }>;
}

export function setOutcome(
  dbPath: string,
  row: { sha: string; outcome: string; derived_at: number; evidence: string | null },
): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO commit_outcomes (sha, outcome, derived_at, evidence)
       VALUES ($sha, $outcome, $derived_at, $evidence)
       ON CONFLICT(sha) DO UPDATE SET outcome=excluded.outcome, derived_at=excluded.derived_at, evidence=excluded.evidence`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export function addRelation(
  dbPath: string,
  row: { sha: string; related_sha: string; relation: string },
): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO commit_relations (sha, related_sha, relation) VALUES ($sha, $related_sha, $relation)
       ON CONFLICT(sha, related_sha, relation) DO NOTHING`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export function addFileTouched(
  dbPath: string,
  row: { sha: string; file_path: string; change_type: string },
): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO files_touched (sha, file_path, change_type) VALUES ($sha, $file_path, $change_type)
       ON CONFLICT(sha, file_path) DO UPDATE SET change_type=excluded.change_type`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export function getFilesForCommit(dbPath: string, sha: string): string[] {
  return (
    getDb(dbPath).prepare(`SELECT file_path FROM files_touched WHERE sha = $sha`).all({ sha }) as Array<{
      file_path: string;
    }>
  ).map((r) => r.file_path);
}

export interface CommitRow {
  sha: string;
  repo_path: string;
  author_date: number | null;
  message: string | null;
  parent_sha: string | null;
}

export function getCommit(dbPath: string, sha: string): CommitRow | undefined {
  return getDb(dbPath).prepare(`SELECT * FROM commits WHERE sha = $sha`).get({ sha }) as CommitRow | undefined;
}

export function getOutcome(
  dbPath: string,
  sha: string,
): { sha: string; outcome: string; derived_at: number | null; evidence: string | null } | undefined {
  return getDb(dbPath).prepare(`SELECT * FROM commit_outcomes WHERE sha = $sha`).get({ sha }) as
    | { sha: string; outcome: string; derived_at: number | null; evidence: string | null }
    | undefined;
}

// Symmetric neighbor lookup: returns commits related to `sha` in either
// direction of the commit_relations edge, along with the relation label as
// recorded (callers decide before/after ordering using commit author_date).
export function getRelatedCommits(
  dbPath: string,
  sha: string,
): Array<{ sha: string; relation: string }> {
  const db_ = getDb(dbPath);
  const outgoing = db_
    .prepare(`SELECT related_sha AS sha, relation FROM commit_relations WHERE sha = $sha`)
    .all({ sha }) as Array<{ sha: string; relation: string }>;
  const incoming = db_
    .prepare(`SELECT sha, relation FROM commit_relations WHERE related_sha = $sha`)
    .all({ sha }) as Array<{ sha: string; relation: string }>;
  return [...outgoing, ...incoming];
}

export function addDocTouched(dbPath: string, row: { ref_id: string; file_path: string }): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO docs_touched (ref_id, file_path) VALUES ($ref_id, $file_path)
       ON CONFLICT(ref_id, file_path) DO NOTHING`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export interface ToolInvocationRow {
  invocation_id: number;
  tool_name: string;
  mcp_method_name: string;
  input_args: string;
  started_at: number;
  duration_ms: number;
  ok: number;
  error_message: string | null;
  git_depth_days: number | null;
  matched_ref: string | null;
  delta_window_scale: number | null;
  warm_lines_pulled: number | null;
  global_lines_skipped: number | null;
  baseline_lines: number | null;
  search_mode: string | null;
}

// Insert-only - telemetry never updates a row after the fact.
export function insertToolInvocation(dbPath: string, row: Omit<ToolInvocationRow, "invocation_id">): number {
  const result = getDb(dbPath)
    .prepare(
      `INSERT INTO tool_invocations
         (tool_name, mcp_method_name, input_args, started_at, duration_ms, ok, error_message,
          git_depth_days, matched_ref, delta_window_scale, warm_lines_pulled, global_lines_skipped, baseline_lines, search_mode)
       VALUES
         ($tool_name, $mcp_method_name, $input_args, $started_at, $duration_ms, $ok, $error_message,
          $git_depth_days, $matched_ref, $delta_window_scale, $warm_lines_pulled, $global_lines_skipped, $baseline_lines, $search_mode)`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
  return Number(result.lastInsertRowid);
}

export function getToolInvocation(dbPath: string, invocationId: number): ToolInvocationRow | undefined {
  return getDb(dbPath)
    .prepare(`SELECT * FROM tool_invocations WHERE invocation_id = $invocation_id`)
    .get({ invocation_id: invocationId }) as ToolInvocationRow | undefined;
}

export function queryInvocations(
  dbPath: string,
  filter: { since?: number; toolName?: string },
): ToolInvocationRow[] {
  const conditions: string[] = [];
  const params: Record<string, import("node:sqlite").SQLInputValue> = {};
  if (filter.since != null) {
    conditions.push("started_at >= $since");
    params.since = filter.since;
  }
  if (filter.toolName) {
    conditions.push("tool_name = $tool_name");
    params.tool_name = filter.toolName;
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return getDb(dbPath)
    .prepare(`SELECT * FROM tool_invocations ${where} ORDER BY invocation_id ASC`)
    .all(params) as unknown as ToolInvocationRow[];
}

export interface FeedbackRow {
  feedback_id: number;
  invocation_id: number | null;
  session_id: string | null;
  verdict: "confirm" | "reject";
  note: string | null;
  created_at: number;
}

export function insertFeedback(dbPath: string, row: Omit<FeedbackRow, "feedback_id">): number {
  const result = getDb(dbPath)
    .prepare(
      `INSERT INTO feedback (invocation_id, session_id, verdict, note, created_at)
       VALUES ($invocation_id, $session_id, $verdict, $note, $created_at)`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
  return Number(result.lastInsertRowid);
}

export function getPenaltyWeight(dbPath: string, sessionId: string): number {
  const row = getDb(dbPath)
    .prepare(`SELECT penalty_weight FROM sessions WHERE session_id = $session_id`)
    .get({ session_id: sessionId }) as { penalty_weight: number } | undefined;
  return row?.penalty_weight ?? 0;
}

export function incrementPenaltyWeight(dbPath: string, sessionId: string, step: number): void {
  getDb(dbPath)
    .prepare(`UPDATE sessions SET penalty_weight = penalty_weight + $step WHERE session_id = $session_id`)
    .run({ session_id: sessionId, step });
}

export function getAllSessions(dbPath: string): SessionRow[] {
  return (
    getDb(dbPath)
      .prepare(
        `SELECT session_id, adapter_id, project_path, git_branch, started_at, ended_at, slug, raw_path, intent, penalty_weight
       FROM sessions ORDER BY started_at DESC`,
      )
      .all() as unknown as SessionRow[]
  );
}
