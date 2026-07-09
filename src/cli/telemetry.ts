#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { defaultSqlitePath } from "../ingest/indexer.js";
import { buildEfficiencyMetrics } from "../mcp/telemetry.js";
import { uploadDueForAllRepos } from "../telemetry/auto-upload.js";
import {
  disableTelemetry,
  enableTelemetry,
  nextUploadDueAt,
  readTelemetryConfig,
  resolveAutoUpload,
  resolveEndpoint,
  resolveUploadIntervalHours,
  setAutoUpload,
  telemetryConfigPath,
} from "../telemetry/config.js";
import { buildTelemetryRollups } from "../telemetry/rollup.js";
import { uploadTelemetryRollups } from "../telemetry/upload.js";

function resolveRepoPath(argvRepo?: string): string {
  if (argvRepo) return argvRepo;
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
}

function parseArgs(argv: string[]): {
  command: string;
  repo?: string;
  dryRun: boolean;
  force: boolean;
  endpoint?: string;
} {
  const args = argv.slice(2);
  const command = args[0] ?? "status";
  let repo: string | undefined;
  let dryRun = false;
  let force = false;
  let endpoint: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--repo" && args[i + 1]) {
      repo = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--force") {
      force = true;
    } else if (args[i] === "--endpoint" && args[i + 1]) {
      endpoint = args[++i];
    }
  }
  return { command, repo, dryRun, force, endpoint };
}

async function main(): Promise<void> {
  const { command, repo, dryRun, force, endpoint } = parseArgs(process.argv);

  if (command === "status") {
    const config = readTelemetryConfig();
    console.log(
      JSON.stringify(
        {
          opt_in: config.opt_in,
          auto_upload: resolveAutoUpload(config),
          install_id: config.install_id,
          endpoint: resolveEndpoint(config),
          config_path: telemetryConfigPath(),
          upload_interval_hours: resolveUploadIntervalHours(config),
          last_upload_at: config.last_upload_at,
          last_uploaded_invocation_id: config.last_uploaded_invocation_id,
          next_upload_due_at: config.opt_in ? nextUploadDueAt(config) : null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "enable") {
    const config = enableTelemetry(endpoint ?? null);
    console.log(`traceback-telemetry: enabled (install_id=${config.install_id}, auto_upload=true)`);
    if (resolveEndpoint(config)) {
      console.log(`traceback-telemetry: endpoint=${resolveEndpoint(config)}`);
    } else {
      console.log("traceback-telemetry: set TRACEBACK_TELEMETRY_ENDPOINT before upload");
    }
    return;
  }

  if (command === "disable") {
    disableTelemetry();
    console.log("traceback-telemetry: disabled");
    return;
  }

  if (command === "auto-upload") {
    const sub = process.argv[3];
    if (sub === "on") {
      setAutoUpload(true);
      console.log("traceback-telemetry: auto-upload on");
      return;
    }
    if (sub === "off") {
      setAutoUpload(false);
      console.log("traceback-telemetry: auto-upload off (manual upload still works when opted in)");
      return;
    }
    console.error("Usage: traceback-telemetry auto-upload <on|off>");
    process.exit(1);
  }

  const repoPath = resolveRepoPath(repo);
  const sqlitePath = defaultSqlitePath(repoPath);

  if (command === "export" || command === "export-local") {
    const report = buildEfficiencyMetrics(sqlitePath, {});
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === "preview") {
    const config = readTelemetryConfig();
    if (!config.install_id) {
      console.error("traceback-telemetry: enable opt-in first (traceback-telemetry enable)");
      process.exit(1);
    }
    const rollups = buildTelemetryRollups({
      sqlitePath,
      repoPath,
      installId: config.install_id,
      afterInvocationId: config.last_uploaded_invocation_id,
    });
    console.log(JSON.stringify(rollups, null, 2));
    return;
  }

  if (command === "upload-due") {
    const results = await uploadDueForAllRepos({ repoPath: repo, dryRun, force });
    const uploaded = results.reduce((s, r) => s + r.uploaded, 0);
    const errors = results.filter((r) => !r.ok && r.error);
    if (errors.length > 0) {
      for (const err of errors) {
        console.error(`traceback-telemetry: upload failed: ${err.error}`);
      }
      process.exit(1);
    }
    if (uploaded === 0) {
      const skip = results.find((r) => r.skipped)?.skipped;
      if (skip) {
        console.log(`traceback-telemetry: upload-due skipped (${skip})`);
      } else {
        console.log("traceback-telemetry: nothing new to upload");
      }
      return;
    }
    if (dryRun) {
      console.log(`traceback-telemetry: dry-run would upload ${uploaded} rollup(s)`);
      return;
    }
    console.log(`traceback-telemetry: uploaded ${uploaded} rollup(s)`);
    return;
  }

  if (command === "upload") {
    const result = await uploadTelemetryRollups({ sqlitePath, repoPath, dryRun });
    if (result.uploaded === 0) {
      console.log("traceback-telemetry: nothing new to upload");
      return;
    }
    if (dryRun) {
      console.log(`traceback-telemetry: dry-run would upload ${result.uploaded} rollup(s) to ${result.endpoint}`);
      return;
    }
    console.log(`traceback-telemetry: uploaded ${result.uploaded} rollup(s) to ${result.endpoint}`);
    return;
  }

  console.error(
    "Usage: traceback-telemetry <status|enable|disable|auto-upload|export|preview|upload|upload-due> [--repo PATH] [--endpoint URL] [--dry-run] [--force]",
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
