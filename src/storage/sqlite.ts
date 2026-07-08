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

CREATE TABLE IF NOT EXISTS coding_patterns (
  pattern_id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path TEXT NOT NULL,
  title TEXT NOT NULL,
  trigger_text TEXT NOT NULL,
  guidance TEXT NOT NULL,
  source_session_id TEXT,
  source_invocation_id INTEGER,
  promotion_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_matched_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS feedback (
  feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
  invocation_id INTEGER,
  session_id TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('confirm','reject')),
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  archive_path TEXT NOT NULL,
  trigger TEXT NOT NULL,
  UNIQUE(adapter_id, source_key)
);

CREATE TABLE IF NOT EXISTS session_attempts (
  session_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL,
  commit_sha TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('kept','reverted','broke_build','superseded','unknown')),
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, attempt_index)
);

CREATE TABLE IF NOT EXISTS index_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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

function ensureTelemetryResponseColumns(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(tool_invocations)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  const additions: Array<[string, string]> = [
    ["response_chars", "INTEGER"],
    ["response_tokens_est", "INTEGER"],
    ["baseline_tokens_est", "INTEGER"],
    ["layer4_skipped", "INTEGER"],
    ["trigger_score", "REAL"],
    ["trigger_decision", "TEXT"],
    ["trigger_terms_count", "INTEGER"],
  ];
  for (const [name, type] of additions) {
    if (!names.has(name)) {
      db.exec(`ALTER TABLE tool_invocations ADD COLUMN ${name} ${type}`);
    }
  }
}

function ensureSessionPhaseAColumns(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  const additions: Array<[string, string]> = [
    ["transcript_ref", "TEXT"],
    ["segment_index", "INTEGER NOT NULL DEFAULT 0"],
    ["source_file_key", "TEXT"],
    ["metadata_json", "TEXT"],
    ["embedding_text", "TEXT"],
    ["indexed_at", "INTEGER"],
  ];
  for (const [name, type] of additions) {
    if (!names.has(name)) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
    }
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
  ensureTelemetryResponseColumns(db);
  ensureSessionPhaseAColumns(db);
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
  transcript_ref?: string | null;
  segment_index?: number;
  source_file_key?: string | null;
  metadata_json?: string | null;
  embedding_text?: string | null;
  indexed_at?: number | null;
}

export function upsertSession(dbPath: string, row: SessionRow): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO sessions (session_id, adapter_id, project_path, git_branch, started_at, ended_at, slug, raw_path, intent,
         transcript_ref, segment_index, source_file_key, metadata_json, embedding_text, indexed_at)
       VALUES ($session_id, $adapter_id, $project_path, $git_branch, $started_at, $ended_at, $slug, $raw_path, $intent,
         $transcript_ref, $segment_index, $source_file_key, $metadata_json, $embedding_text, $indexed_at)
       ON CONFLICT(session_id) DO UPDATE SET
         adapter_id=excluded.adapter_id, project_path=excluded.project_path, git_branch=excluded.git_branch,
         started_at=excluded.started_at, ended_at=excluded.ended_at, slug=excluded.slug, raw_path=excluded.raw_path,
         intent=excluded.intent, transcript_ref=excluded.transcript_ref, segment_index=excluded.segment_index,
         source_file_key=excluded.source_file_key, metadata_json=excluded.metadata_json,
         embedding_text=excluded.embedding_text, indexed_at=excluded.indexed_at`,
    )
    .run({
      ...row,
      transcript_ref: row.transcript_ref ?? null,
      segment_index: row.segment_index ?? 0,
      source_file_key: row.source_file_key ?? null,
      metadata_json: row.metadata_json ?? null,
      embedding_text: row.embedding_text ?? null,
      indexed_at: row.indexed_at ?? null,
    } as unknown as Record<string, import("node:sqlite").SQLInputValue>);
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
  response_chars: number | null;
  response_tokens_est: number | null;
  baseline_tokens_est: number | null;
  layer4_skipped: number | null;
  trigger_score: number | null;
  trigger_decision: string | null;
  trigger_terms_count: number | null;
}

// Insert-only - telemetry never updates a row after the fact.
export function insertToolInvocation(dbPath: string, row: Omit<ToolInvocationRow, "invocation_id">): number {
  const result = getDb(dbPath)
    .prepare(
      `INSERT INTO tool_invocations
         (tool_name, mcp_method_name, input_args, started_at, duration_ms, ok, error_message,
          git_depth_days, matched_ref, delta_window_scale, warm_lines_pulled, global_lines_skipped, baseline_lines, search_mode,
          response_chars, response_tokens_est, baseline_tokens_est, layer4_skipped,
          trigger_score, trigger_decision, trigger_terms_count)
       VALUES
         ($tool_name, $mcp_method_name, $input_args, $started_at, $duration_ms, $ok, $error_message,
          $git_depth_days, $matched_ref, $delta_window_scale, $warm_lines_pulled, $global_lines_skipped, $baseline_lines, $search_mode,
          $response_chars, $response_tokens_est, $baseline_tokens_est, $layer4_skipped,
          $trigger_score, $trigger_decision, $trigger_terms_count)`,
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
        `SELECT session_id, adapter_id, project_path, git_branch, started_at, ended_at, slug, raw_path, intent, penalty_weight,
                transcript_ref, segment_index, source_file_key, metadata_json, embedding_text, indexed_at
       FROM sessions ORDER BY started_at DESC`,
      )
      .all() as unknown as SessionRow[]
  );
}

export function getSessionBySourceFileKey(dbPath: string, sourceFileKey: string): SessionRow | undefined {
  return getDb(dbPath)
    .prepare(`SELECT * FROM sessions WHERE source_file_key = $source_file_key`)
    .get({ source_file_key: sourceFileKey }) as SessionRow | undefined;
}

export interface ArchiveRecordRow {
  id: number;
  adapter_id: string;
  source_key: string;
  archived_at: number;
  archive_path: string;
  trigger: string;
}

export function upsertArchiveRecord(
  dbPath: string,
  row: Omit<ArchiveRecordRow, "id">,
): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO archive_records (adapter_id, source_key, archived_at, archive_path, trigger)
       VALUES ($adapter_id, $source_key, $archived_at, $archive_path, $trigger)
       ON CONFLICT(adapter_id, source_key) DO UPDATE SET
         archived_at=excluded.archived_at, archive_path=excluded.archive_path, trigger=excluded.trigger`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export function getArchiveRecord(
  dbPath: string,
  adapterId: string,
  sourceKey: string,
): ArchiveRecordRow | undefined {
  return getDb(dbPath)
    .prepare(`SELECT * FROM archive_records WHERE adapter_id = $adapter_id AND source_key = $source_key`)
    .get({ adapter_id: adapterId, source_key: sourceKey }) as ArchiveRecordRow | undefined;
}

export interface SessionAttemptRow {
  session_id: string;
  attempt_index: number;
  commit_sha: string;
  outcome: string;
  linked_at: number;
}

export function upsertSessionAttempt(dbPath: string, row: SessionAttemptRow): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO session_attempts (session_id, attempt_index, commit_sha, outcome, linked_at)
       VALUES ($session_id, $attempt_index, $commit_sha, $outcome, $linked_at)
       ON CONFLICT(session_id, attempt_index) DO UPDATE SET
         commit_sha=excluded.commit_sha, outcome=excluded.outcome, linked_at=excluded.linked_at`,
    )
    .run(row as unknown as Record<string, import("node:sqlite").SQLInputValue>);
}

export function getSessionAttempts(dbPath: string, sessionId: string): SessionAttemptRow[] {
  return getDb(dbPath)
    .prepare(
      `SELECT session_id, attempt_index, commit_sha, outcome, linked_at FROM session_attempts
       WHERE session_id = $session_id ORDER BY attempt_index ASC`,
    )
    .all({ session_id: sessionId }) as unknown as SessionAttemptRow[];
}

export function getIndexState(dbPath: string, key: string): string | undefined {
  const row = getDb(dbPath)
    .prepare(`SELECT value FROM index_state WHERE key = $key`)
    .get({ key }) as { value: string } | undefined;
  return row?.value;
}

export function setIndexState(dbPath: string, key: string, value: string): void {
  getDb(dbPath)
    .prepare(
      `INSERT INTO index_state (key, value) VALUES ($key, $value)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .run({ key, value });
}

export function querySessions(
  dbPath: string,
  filter: { adapter_id?: string; outcome?: string },
): SessionRow[] {
  const conditions: string[] = [];
  const params: Record<string, import("node:sqlite").SQLInputValue> = {};
  if (filter.adapter_id) {
    conditions.push("s.adapter_id = $adapter_id");
    params.adapter_id = filter.adapter_id;
  }
  if (filter.outcome) {
    conditions.push(`EXISTS (
      SELECT 1 FROM session_commit_links scl
      JOIN commit_outcomes co ON co.sha = scl.sha
      WHERE scl.session_id = s.session_id AND co.outcome = $outcome
    )`);
    params.outcome = filter.outcome;
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return getDb(dbPath)
    .prepare(
      `SELECT s.session_id, s.adapter_id, s.project_path, s.git_branch, s.started_at, s.ended_at, s.slug, s.raw_path,
              s.intent, s.penalty_weight, s.transcript_ref, s.segment_index, s.source_file_key, s.metadata_json,
              s.embedding_text, s.indexed_at
       FROM sessions s ${where} ORDER BY s.started_at DESC`,
    )
    .all(params) as unknown as SessionRow[];
}

export interface CodingPatternRow {
  pattern_id: number;
  repo_path: string;
  title: string;
  trigger_text: string;
  guidance: string;
  source_session_id: string | null;
  source_invocation_id: number | null;
  promotion_count: number;
  created_at: number;
  last_matched_at: number | null;
  active: number;
}

export function insertCodingPattern(
  dbPath: string,
  row: Omit<CodingPatternRow, "pattern_id" | "promotion_count" | "active" | "last_matched_at">,
): number {
  const result = getDb(dbPath)
    .prepare(
      `INSERT INTO coding_patterns
        (repo_path, title, trigger_text, guidance, source_session_id, source_invocation_id, promotion_count, created_at, last_matched_at, active)
       VALUES
        ($repo_path, $title, $trigger_text, $guidance, $source_session_id, $source_invocation_id, 1, $created_at, NULL, 1)`,
    )
    .run({
      ...row,
      source_session_id: row.source_session_id ?? null,
      source_invocation_id: row.source_invocation_id ?? null,
    } as unknown as Record<string, import("node:sqlite").SQLInputValue>);
  return Number(result.lastInsertRowid);
}

export function listCodingPatterns(dbPath: string, repoPath: string): CodingPatternRow[] {
  return getDb(dbPath)
    .prepare(
      `SELECT * FROM coding_patterns
       WHERE repo_path = $repo_path AND active = 1
       ORDER BY COALESCE(last_matched_at, created_at) DESC, pattern_id DESC`,
    )
    .all({ repo_path: repoPath }) as unknown as CodingPatternRow[];
}

export function deactivateCodingPattern(dbPath: string, patternId: number): void {
  getDb(dbPath)
    .prepare(`UPDATE coding_patterns SET active = 0 WHERE pattern_id = $pattern_id`)
    .run({ pattern_id: patternId });
}

export function touchCodingPattern(dbPath: string, patternId: number): void {
  getDb(dbPath)
    .prepare(
      `UPDATE coding_patterns
       SET last_matched_at = $now, promotion_count = promotion_count + 1
       WHERE pattern_id = $pattern_id`,
    )
    .run({ pattern_id: patternId, now: Date.now() });
}

export function countCodingPatterns(dbPath: string, repoPath: string): number {
  const row = getDb(dbPath)
    .prepare(`SELECT COUNT(*) AS cnt FROM coding_patterns WHERE repo_path = $repo_path AND active = 1`)
    .get({ repo_path: repoPath }) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}
