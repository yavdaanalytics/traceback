import { existsSync } from "node:fs";
import { listRegisteredRepos } from "../dashboard/registry.js";
import { defaultSqlitePath } from "../ingest/indexer.js";
import {
  readTelemetryConfig,
  resolveAutoUpload,
  resolveEndpoint,
  resolveUploadIntervalHours,
  type TelemetryConfig,
} from "./config.js";
import { uploadTelemetryRollups } from "./upload.js";

export interface AutoUploadResult {
  ok: boolean;
  uploaded: number;
  endpoint: string | null;
  skipped?: "not_opted_in" | "auto_upload_off" | "no_endpoint" | "not_due" | "no_db";
  error?: string;
}

export function isUploadDue(config: TelemetryConfig = readTelemetryConfig(), now = Date.now()): boolean {
  if (!config.last_upload_at) return true;
  const intervalMs = resolveUploadIntervalHours(config) * 3_600_000;
  return now - Date.parse(config.last_upload_at) >= intervalMs;
}

export function shouldAutoUpload(config: TelemetryConfig = readTelemetryConfig()): boolean {
  return Boolean(
    config.opt_in && config.install_id && resolveAutoUpload(config) && resolveEndpoint(config),
  );
}

export async function maybeUploadDue(opts: {
  sqlitePath: string;
  repoPath: string;
  dryRun?: boolean;
  force?: boolean;
}): Promise<AutoUploadResult> {
  const config = readTelemetryConfig();
  if (!config.opt_in || !config.install_id) {
    return { ok: true, uploaded: 0, endpoint: resolveEndpoint(config), skipped: "not_opted_in" };
  }
  if (!resolveAutoUpload(config)) {
    return { ok: true, uploaded: 0, endpoint: resolveEndpoint(config), skipped: "auto_upload_off" };
  }
  const endpoint = resolveEndpoint(config);
  if (!endpoint) {
    return { ok: true, uploaded: 0, endpoint: null, skipped: "no_endpoint" };
  }
  if (!existsSync(opts.sqlitePath)) {
    return { ok: true, uploaded: 0, endpoint, skipped: "no_db" };
  }
  if (!opts.force && !isUploadDue(config)) {
    return { ok: true, uploaded: 0, endpoint, skipped: "not_due" };
  }

  try {
    const result = await uploadTelemetryRollups({
      sqlitePath: opts.sqlitePath,
      repoPath: opts.repoPath,
      dryRun: opts.dryRun,
    });
    return { ok: true, uploaded: result.uploaded, endpoint: result.endpoint };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, uploaded: 0, endpoint, error: message };
  }
}

export async function uploadDueForAllRepos(opts?: {
  repoPath?: string;
  dryRun?: boolean;
  force?: boolean;
}): Promise<AutoUploadResult[]> {
  const config = readTelemetryConfig();
  if (!shouldAutoUpload(config) && !opts?.force) {
    const endpoint = resolveEndpoint(config);
    if (!config.opt_in) {
      return [{ ok: true, uploaded: 0, endpoint, skipped: "not_opted_in" }];
    }
    if (!resolveAutoUpload(config)) {
      return [{ ok: true, uploaded: 0, endpoint, skipped: "auto_upload_off" }];
    }
    if (!endpoint) {
      return [{ ok: true, uploaded: 0, endpoint: null, skipped: "no_endpoint" }];
    }
    if (!opts?.force && !isUploadDue(config)) {
      return [{ ok: true, uploaded: 0, endpoint, skipped: "not_due" }];
    }
  }

  const repos = listRegisteredRepos();
  const seen = new Set<string>();
  const targets: Array<{ repoPath: string; sqlitePath: string }> = [];

  for (const row of repos) {
    if (seen.has(row.repoRoot)) continue;
    seen.add(row.repoRoot);
    targets.push({ repoPath: row.repoRoot, sqlitePath: row.sqlitePath });
  }

  if (opts?.repoPath) {
    const sqlitePath = defaultSqlitePath(opts.repoPath);
    if (!seen.has(opts.repoPath)) {
      targets.push({ repoPath: opts.repoPath, sqlitePath });
    }
  }

  if (targets.length === 0) {
    return [{ ok: true, uploaded: 0, endpoint: resolveEndpoint(config), skipped: "no_db" }];
  }

  const results: AutoUploadResult[] = [];
  for (const target of targets) {
    results.push(
      await maybeUploadDue({
        sqlitePath: target.sqlitePath,
        repoPath: target.repoPath,
        dryRun: opts?.dryRun,
        force: opts?.force,
      }),
    );
  }
  return results;
}
