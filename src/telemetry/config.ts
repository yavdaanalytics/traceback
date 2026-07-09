import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export interface TelemetryConfig {
  version: 1;
  opt_in: boolean;
  install_id: string | null;
  last_upload_at: string | null;
  last_uploaded_invocation_id: number;
  endpoint: string | null;
  auto_upload: boolean;
  upload_interval_hours: number;
  declined_sharing?: boolean;
}

function configPath(): string {
  if (process.env.TRACEBACK_TELEMETRY_CONFIG_PATH?.trim()) {
    return process.env.TRACEBACK_TELEMETRY_CONFIG_PATH.trim();
  }
  return join(homedir(), ".traceback", "telemetry.json");
}

const DEFAULT_UPLOAD_INTERVAL_HOURS = 24;

const DEFAULT_CONFIG: TelemetryConfig = {
  version: 1,
  opt_in: false,
  install_id: null,
  last_upload_at: null,
  last_uploaded_invocation_id: 0,
  endpoint: null,
  auto_upload: false,
  upload_interval_hours: DEFAULT_UPLOAD_INTERVAL_HOURS,
};

export function readTelemetryConfig(): TelemetryConfig {
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<TelemetryConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      version: 1,
      upload_interval_hours:
        typeof parsed.upload_interval_hours === "number" && parsed.upload_interval_hours > 0
          ? parsed.upload_interval_hours
          : DEFAULT_UPLOAD_INTERVAL_HOURS,
      auto_upload: parsed.auto_upload === true,
      declined_sharing: parsed.declined_sharing === true,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeTelemetryConfig(config: TelemetryConfig): void {
  const path = configPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function resolveEndpoint(config: TelemetryConfig = readTelemetryConfig()): string | null {
  const env = process.env.TRACEBACK_TELEMETRY_ENDPOINT?.trim();
  if (env) return env;
  return config.endpoint;
}

export function resolveUploadIntervalHours(config: TelemetryConfig = readTelemetryConfig()): number {
  const env = process.env.TRACEBACK_TELEMETRY_UPLOAD_INTERVAL_HOURS?.trim();
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return config.upload_interval_hours;
}

export function resolveAutoUpload(config: TelemetryConfig = readTelemetryConfig()): boolean {
  const env = process.env.TRACEBACK_TELEMETRY_AUTO_UPLOAD?.trim().toLowerCase();
  if (env === "true" || env === "1" || env === "yes") return true;
  if (env === "false" || env === "0" || env === "no") return false;
  return config.auto_upload;
}

export function nextUploadDueAt(config: TelemetryConfig = readTelemetryConfig()): string | null {
  if (!config.last_upload_at) return new Date().toISOString();
  const intervalMs = resolveUploadIntervalHours(config) * 3_600_000;
  return new Date(Date.parse(config.last_upload_at) + intervalMs).toISOString();
}

function telemetryOptInEnvEnabled(): boolean {
  const env = process.env.TRACEBACK_TELEMETRY_OPT_IN?.trim().toLowerCase();
  return env === "true" || env === "1" || env === "yes";
}

/** Persist opt-in when MCP env (e.g. plugin mcp.json) requests it and user has not declined or disabled sharing. */
export function ensureTelemetryOptInFromEnv(): TelemetryConfig {
  const current = readTelemetryConfig();
  if (current.opt_in || !telemetryOptInEnvEnabled()) return current;
  if (current.declined_sharing || (current.install_id && !current.opt_in)) return current;
  return enableTelemetry(process.env.TRACEBACK_TELEMETRY_ENDPOINT?.trim() || null);
}

export function enableTelemetry(endpoint?: string | null): TelemetryConfig {
  const current = readTelemetryConfig();
  const next: TelemetryConfig = {
    ...current,
    opt_in: true,
    auto_upload: true,
    declined_sharing: false,
    install_id: current.install_id ?? randomUUID(),
    endpoint: endpoint ?? current.endpoint ?? resolveEndpoint(current),
  };
  writeTelemetryConfig(next);
  return next;
}

export function disableTelemetry(): TelemetryConfig {
  const current = readTelemetryConfig();
  const next: TelemetryConfig = {
    ...current,
    opt_in: false,
    auto_upload: false,
  };
  writeTelemetryConfig(next);
  return next;
}

export function setAutoUpload(enabled: boolean): TelemetryConfig {
  const current = readTelemetryConfig();
  if (enabled && !current.opt_in) {
    throw new Error("Telemetry opt-in is disabled. Run: traceback-telemetry enable");
  }
  const next: TelemetryConfig = {
    ...current,
    auto_upload: enabled,
  };
  writeTelemetryConfig(next);
  return next;
}

export function markUploadSuccess(lastUploadedInvocationId: number): TelemetryConfig {
  const current = readTelemetryConfig();
  const next: TelemetryConfig = {
    ...current,
    last_upload_at: new Date().toISOString(),
    last_uploaded_invocation_id: lastUploadedInvocationId,
  };
  writeTelemetryConfig(next);
  return next;
}

export function telemetryConfigPath(): string {
  return configPath();
}
