import { resolveEndpoint, readTelemetryConfig, markUploadSuccess } from "./config.js";
import { buildTelemetryRollups, maxInvocationIdForRepo } from "./rollup.js";
import { TelemetryRollupBatchSchema } from "./schema.js";

export async function uploadTelemetryRollups(opts: {
  sqlitePath: string;
  repoPath: string;
  dryRun?: boolean;
}): Promise<{ uploaded: number; endpoint: string | null; maxInvocationId: number }> {
  const config = readTelemetryConfig();
  if (!config.opt_in || !config.install_id) {
    throw new Error("Telemetry opt-in is disabled. Run: traceback-telemetry enable");
  }
  const endpoint = resolveEndpoint(config);
  if (!endpoint) {
    throw new Error("No telemetry endpoint configured. Set TRACEBACK_TELEMETRY_ENDPOINT or config.endpoint");
  }

  const rollups = buildTelemetryRollups({
    sqlitePath: opts.sqlitePath,
    repoPath: opts.repoPath,
    installId: config.install_id,
    afterInvocationId: config.last_uploaded_invocation_id,
  });
  const maxId = maxInvocationIdForRepo(opts.sqlitePath);
  if (rollups.length === 0) {
    return { uploaded: 0, endpoint, maxInvocationId: maxId };
  }

  TelemetryRollupBatchSchema.parse(rollups);

  if (opts.dryRun) {
    return { uploaded: rollups.length, endpoint, maxInvocationId: maxId };
  }

  const response = await fetch(endpoint.replace(/\/$/, "") + "/v1/rollups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rollups),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telemetry upload failed (${response.status}): ${body}`);
  }

  markUploadSuccess(maxId);
  return { uploaded: rollups.length, endpoint, maxInvocationId: maxId };
}
