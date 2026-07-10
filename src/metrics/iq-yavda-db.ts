import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS iq_yavda_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  install_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ts TEXT NOT NULL,
  detail TEXT,
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_iq_yavda_ts ON iq_yavda_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_iq_yavda_type ON iq_yavda_events(event_type);
`;

interface IQYavdaEvent {
  install_id: string;
  repo_id: string;
  event_type: string;
  ts: string;
  detail?: Record<string, unknown>;
}

let dbHandle: DatabaseSync | null = null;
let dbPathKey = "";

function getDb(dbPath: string): DatabaseSync {
  const key = resolve(dbPath);
  if (dbHandle && dbPathKey === key) return dbHandle;
  const dir = dirname(key);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(key);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  dbHandle = db;
  dbPathKey = key;
  return db;
}

export function insertIQYavdaEvents(dbPath: string, events: IQYavdaEvent[]): number {
  const db = getDb(dbPath);
  const stmt = db.prepare(
    "INSERT INTO iq_yavda_events (install_id, repo_id, event_type, ts, detail, received_at) VALUES (?, ?, ?, ?, ?, ?)"
  );

  let inserted = 0;
  for (const event of events) {
    stmt.run(
      event.install_id,
      event.repo_id,
      event.event_type,
      event.ts,
      event.detail ? JSON.stringify(event.detail) : null,
      Date.now()
    );
    inserted++;
  }
  return inserted;
}

export function getIQYavdaStats(dbPath: string): {
  total_installs: number;
  total_repos: number;
  total_events: number;
  by_type: Record<string, number>;
  recent_events: Array<{ install_id: string; repo_id: string; event_type: string; ts: string }>;
} {
  const db = getDb(dbPath);

  const totalInstalls = (
    db.prepare("SELECT COUNT(DISTINCT install_id) as count FROM iq_yavda_events").get() as { count: number }
  ).count;

  const totalRepos = (
    db.prepare("SELECT COUNT(DISTINCT repo_id) as count FROM iq_yavda_events").get() as { count: number }
  ).count;

  const totalEvents = (
    db.prepare("SELECT COUNT(*) as count FROM iq_yavda_events").get() as { count: number }
  ).count;

  const byType = Object.fromEntries(
    (db.prepare("SELECT event_type, COUNT(*) as count FROM iq_yavda_events GROUP BY event_type").all() as Array<{
      event_type: string;
      count: number;
    }>).map((row) => [row.event_type, row.count])
  );

  const recentEvents = db
    .prepare(
      "SELECT install_id, repo_id, event_type, ts FROM iq_yavda_events ORDER BY ts DESC LIMIT 50"
    )
    .all() as Array<{ install_id: string; repo_id: string; event_type: string; ts: string }>;

  return {
    total_installs: totalInstalls,
    total_repos: totalRepos,
    total_events: totalEvents,
    by_type: byType,
    recent_events: recentEvents,
  };
}
