import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
`;

// Uses Node's built-in node:sqlite (stable enough on this Node version, see
// build note below) instead of better-sqlite3: better-sqlite3 ships prebuilt
// native binaries per Node ABI/platform and has none published yet for this
// Node version, falling back to node-gyp, which requires a C++ toolchain
// (Visual Studio Build Tools on Windows) not present on this machine. Using
// the runtime's own SQLite avoids that native-binary install friction
// entirely - it ships with Node, zero extra install.
let db: DatabaseSync | undefined;

export function getDb(dbPath: string): DatabaseSync {
  if (db) return db;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
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
