import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TelemetryRollupV1 } from "../telemetry/schema.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS telemetry_rollups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version TEXT NOT NULL,
  install_id TEXT NOT NULL,
  repo_hash TEXT NOT NULL,
  traceback_version TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  invocation_count INTEGER NOT NULL,
  failure_count INTEGER NOT NULL,
  duration_ms_p50 REAL NOT NULL,
  duration_ms_p95 REAL NOT NULL,
  lines_saved_total INTEGER NOT NULL,
  warm_lines_total INTEGER NOT NULL,
  baseline_lines_total INTEGER NOT NULL,
  feedback_confirm_count INTEGER NOT NULL,
  feedback_reject_count INTEGER NOT NULL,
  search_mode_counts_json TEXT,
  response_tokens_total INTEGER,
  baseline_tokens_total INTEGER,
  git_depth_days_avg REAL,
  git_depth_days_p50 REAL,
  layer4_skipped_count INTEGER,
  layer4_total_count INTEGER,
  trigger_decision_counts_json TEXT,
  trigger_score_avg REAL,
  trigger_terms_count_avg REAL,
  delta_window_scale_avg REAL,
  received_at INTEGER NOT NULL,
  UNIQUE(install_id, repo_hash, period_start, tool_name, traceback_version)
);
`;

const ADDITIVE_COLUMNS: Array<[string, string]> = [
  ["response_tokens_total", "INTEGER"],
  ["baseline_tokens_total", "INTEGER"],
  ["git_depth_days_avg", "REAL"],
  ["git_depth_days_p50", "REAL"],
  ["layer4_skipped_count", "INTEGER"],
  ["layer4_total_count", "INTEGER"],
  ["trigger_decision_counts_json", "TEXT"],
  ["trigger_score_avg", "REAL"],
  ["trigger_terms_count_avg", "REAL"],
  ["delta_window_scale_avg", "REAL"],
];

let dbHandle: DatabaseSync | null = null;
let dbPathKey = "";

function migrateCollectorSchema(db: DatabaseSync): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(telemetry_rollups)`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  for (const [name, type] of ADDITIVE_COLUMNS) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE telemetry_rollups ADD COLUMN ${name} ${type}`);
  }
}

export function getCollectorDb(dbPath: string): DatabaseSync {
  const key = resolve(dbPath);
  if (dbHandle && dbPathKey === key) return dbHandle;
  const dir = dirname(key);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(key);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  migrateCollectorSchema(db);
  dbHandle = db;
  dbPathKey = key;
  return db;
}

export function upsertTelemetryRollups(dbPath: string, rollups: TelemetryRollupV1[]): number {
  const db = getCollectorDb(dbPath);
  const stmt = db.prepare(
    `INSERT INTO telemetry_rollups (
      schema_version, install_id, repo_hash, traceback_version, period_start, period_end, tool_name,
      invocation_count, failure_count, duration_ms_p50, duration_ms_p95,
      lines_saved_total, warm_lines_total, baseline_lines_total,
      feedback_confirm_count, feedback_reject_count, search_mode_counts_json,
      response_tokens_total, baseline_tokens_total, git_depth_days_avg, git_depth_days_p50,
      layer4_skipped_count, layer4_total_count, trigger_decision_counts_json,
      trigger_score_avg, trigger_terms_count_avg, delta_window_scale_avg, received_at
    ) VALUES (
      $schema_version, $install_id, $repo_hash, $traceback_version, $period_start, $period_end, $tool_name,
      $invocation_count, $failure_count, $duration_ms_p50, $duration_ms_p95,
      $lines_saved_total, $warm_lines_total, $baseline_lines_total,
      $feedback_confirm_count, $feedback_reject_count, $search_mode_counts_json,
      $response_tokens_total, $baseline_tokens_total, $git_depth_days_avg, $git_depth_days_p50,
      $layer4_skipped_count, $layer4_total_count, $trigger_decision_counts_json,
      $trigger_score_avg, $trigger_terms_count_avg, $delta_window_scale_avg, $received_at
    )
    ON CONFLICT(install_id, repo_hash, period_start, tool_name, traceback_version) DO UPDATE SET
      period_end=excluded.period_end,
      invocation_count=excluded.invocation_count,
      failure_count=excluded.failure_count,
      duration_ms_p50=excluded.duration_ms_p50,
      duration_ms_p95=excluded.duration_ms_p95,
      lines_saved_total=excluded.lines_saved_total,
      warm_lines_total=excluded.warm_lines_total,
      baseline_lines_total=excluded.baseline_lines_total,
      feedback_confirm_count=excluded.feedback_confirm_count,
      feedback_reject_count=excluded.feedback_reject_count,
      search_mode_counts_json=excluded.search_mode_counts_json,
      response_tokens_total=excluded.response_tokens_total,
      baseline_tokens_total=excluded.baseline_tokens_total,
      git_depth_days_avg=excluded.git_depth_days_avg,
      git_depth_days_p50=excluded.git_depth_days_p50,
      layer4_skipped_count=excluded.layer4_skipped_count,
      layer4_total_count=excluded.layer4_total_count,
      trigger_decision_counts_json=excluded.trigger_decision_counts_json,
      trigger_score_avg=excluded.trigger_score_avg,
      trigger_terms_count_avg=excluded.trigger_terms_count_avg,
      delta_window_scale_avg=excluded.delta_window_scale_avg,
      received_at=excluded.received_at`,
  );
  const now = Date.now();
  let count = 0;
  for (const row of rollups) {
    stmt.run({
      schema_version: row.schema_version,
      install_id: row.install_id,
      repo_hash: row.repo_hash,
      traceback_version: row.traceback_version,
      period_start: row.period_start,
      period_end: row.period_end,
      tool_name: row.tool_name,
      invocation_count: row.invocation_count,
      failure_count: row.failure_count,
      duration_ms_p50: row.duration_ms_p50,
      duration_ms_p95: row.duration_ms_p95,
      lines_saved_total: row.lines_saved_total,
      warm_lines_total: row.warm_lines_total,
      baseline_lines_total: row.baseline_lines_total,
      feedback_confirm_count: row.feedback_confirm_count,
      feedback_reject_count: row.feedback_reject_count,
      search_mode_counts_json: row.search_mode_counts ? JSON.stringify(row.search_mode_counts) : null,
      response_tokens_total: row.response_tokens_total ?? null,
      baseline_tokens_total: row.baseline_tokens_total ?? null,
      git_depth_days_avg: row.git_depth_days_avg ?? null,
      git_depth_days_p50: row.git_depth_days_p50 ?? null,
      layer4_skipped_count: row.layer4_skipped_count ?? null,
      layer4_total_count: row.layer4_total_count ?? null,
      trigger_decision_counts_json: row.trigger_decision_counts
        ? JSON.stringify(row.trigger_decision_counts)
        : null,
      trigger_score_avg: row.trigger_score_avg ?? null,
      trigger_terms_count_avg: row.trigger_terms_count_avg ?? null,
      delta_window_scale_avg: row.delta_window_scale_avg ?? null,
      received_at: now,
    } as unknown as Record<string, import("node:sqlite").SQLInputValue>);
    count++;
  }
  return count;
}

export interface CollectorRollupRow {
  schema_version: string;
  install_id: string;
  repo_hash: string;
  traceback_version: string;
  period_start: string;
  period_end: string;
  tool_name: string;
  invocation_count: number;
  failure_count: number;
  duration_ms_p50: number;
  duration_ms_p95: number;
  lines_saved_total: number;
  warm_lines_total: number;
  baseline_lines_total: number;
  feedback_confirm_count: number;
  feedback_reject_count: number;
  search_mode_counts_json: string | null;
  response_tokens_total: number | null;
  baseline_tokens_total: number | null;
  git_depth_days_avg: number | null;
  git_depth_days_p50: number | null;
  layer4_skipped_count: number | null;
  layer4_total_count: number | null;
  trigger_decision_counts_json: string | null;
  trigger_score_avg: number | null;
  trigger_terms_count_avg: number | null;
  delta_window_scale_avg: number | null;
}

export function listCollectorRollups(dbPath: string): CollectorRollupRow[] {
  return getCollectorDb(dbPath)
    .prepare(`SELECT * FROM telemetry_rollups ORDER BY period_start ASC, tool_name ASC`)
    .all() as unknown as CollectorRollupRow[];
}
