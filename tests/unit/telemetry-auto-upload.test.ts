import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTelemetry } from "../../src/mcp/telemetry.js";
import {
  isUploadDue,
  maybeUploadDue,
  shouldAutoUpload,
  uploadDueForAllRepos,
} from "../../src/telemetry/auto-upload.js";
import {
  disableTelemetry,
  enableTelemetry,
  ensureTelemetryOptInFromEnv,
  readTelemetryConfig,
  setAutoUpload,
  writeTelemetryConfig,
} from "../../src/telemetry/config.js";

let tmpDir: string;
let dbPath: string;
let repoPath: string;
let configPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-auto-upload-test-"));
  repoPath = join(tmpDir, "repo");
  mkdirSync(join(repoPath, "data"), { recursive: true });
  dbPath = join(repoPath, "data", "traceback.db");
  configPath = join(tmpDir, "telemetry.json");
  process.env.TRACEBACK_TELEMETRY_CONFIG_PATH = configPath;
  delete process.env.TRACEBACK_TELEMETRY_AUTO_UPLOAD;
  delete process.env.TRACEBACK_TELEMETRY_UPLOAD_INTERVAL_HOURS;
  delete process.env.TRACEBACK_TELEMETRY_ENDPOINT;
});

afterEach(() => {
  delete process.env.TRACEBACK_TELEMETRY_CONFIG_PATH;
  delete process.env.TRACEBACK_TELEMETRY_AUTO_UPLOAD;
  delete process.env.TRACEBACK_TELEMETRY_UPLOAD_INTERVAL_HOURS;
  delete process.env.TRACEBACK_TELEMETRY_ENDPOINT;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("isUploadDue", () => {
  it("returns true when last_upload_at is null", () => {
    expect(isUploadDue(readTelemetryConfig())).toBe(true);
  });

  it("respects upload_interval_hours", () => {
    const now = Date.parse("2026-07-08T12:00:00.000Z");
    writeTelemetryConfig({
      ...readTelemetryConfig(),
      opt_in: true,
      install_id: "11111111-1111-4111-8111-111111111111",
      last_upload_at: "2026-07-07T11:00:00.000Z",
      upload_interval_hours: 24,
    });
    expect(isUploadDue(readTelemetryConfig(), now)).toBe(true);

    writeTelemetryConfig({
      ...readTelemetryConfig(),
      last_upload_at: "2026-07-08T11:00:00.000Z",
      upload_interval_hours: 24,
    });
    expect(isUploadDue(readTelemetryConfig(), now)).toBe(false);
  });
});

describe("ensureTelemetryOptInFromEnv", () => {
  it("enables opt-in when env is true and config is off", () => {
    disableTelemetry();
    process.env.TRACEBACK_TELEMETRY_OPT_IN = "true";
    const config = ensureTelemetryOptInFromEnv();
    expect(config.opt_in).toBe(true);
    expect(config.auto_upload).toBe(true);
  });

  it("does not re-enable when user disabled sharing", () => {
    enableTelemetry("http://127.0.0.1:5566");
    disableTelemetry();
    process.env.TRACEBACK_TELEMETRY_OPT_IN = "true";
    const config = ensureTelemetryOptInFromEnv();
    expect(config.opt_in).toBe(false);
  });

  it("is a no-op when already opted in", () => {
    const enabled = enableTelemetry("http://127.0.0.1:5566");
    process.env.TRACEBACK_TELEMETRY_OPT_IN = "true";
    const config = ensureTelemetryOptInFromEnv();
    expect(config.install_id).toBe(enabled.install_id);
    expect(config.opt_in).toBe(true);
  });

  it("does not enable when user declined sharing in setup", () => {
    writeTelemetryConfig({
      ...readTelemetryConfig(),
      opt_in: false,
      auto_upload: false,
      declined_sharing: true,
    });
    process.env.TRACEBACK_TELEMETRY_OPT_IN = "true";
    const config = ensureTelemetryOptInFromEnv();
    expect(config.opt_in).toBe(false);
    expect(config.declined_sharing).toBe(true);
  });
});

describe("telemetry config auto_upload", () => {
  it("enableTelemetry sets opt_in and auto_upload", () => {
    const config = enableTelemetry("http://127.0.0.1:5566");
    expect(config.opt_in).toBe(true);
    expect(config.auto_upload).toBe(true);
  });

  it("setAutoUpload(false) leaves opt_in true for manual-only mode", () => {
    enableTelemetry("http://127.0.0.1:5566");
    setAutoUpload(false);
    const config = readTelemetryConfig();
    expect(config.opt_in).toBe(true);
    expect(config.auto_upload).toBe(false);
  });

  it("disableTelemetry clears both flags", () => {
    enableTelemetry("http://127.0.0.1:5566");
    disableTelemetry();
    const config = readTelemetryConfig();
    expect(config.opt_in).toBe(false);
    expect(config.auto_upload).toBe(false);
  });

  it("setAutoUpload(true) requires opt_in", () => {
    disableTelemetry();
    expect(() => setAutoUpload(true)).toThrow(/opt-in is disabled/i);
  });
});

describe("shouldAutoUpload", () => {
  it("requires opt_in, install_id, auto_upload, and endpoint", () => {
    disableTelemetry();
    expect(shouldAutoUpload()).toBe(false);

    enableTelemetry("http://127.0.0.1:5566");
    expect(shouldAutoUpload()).toBe(true);

    setAutoUpload(false);
    expect(shouldAutoUpload()).toBe(false);
  });
});

describe("maybeUploadDue", () => {
  it("skips when not opted in", async () => {
    const result = await maybeUploadDue({ sqlitePath: dbPath, repoPath });
    expect(result.skipped).toBe("not_opted_in");
    expect(result.uploaded).toBe(0);
  });

  it("skips when auto_upload is off", async () => {
    enableTelemetry("http://127.0.0.1:5566");
    setAutoUpload(false);
    const result = await maybeUploadDue({ sqlitePath: dbPath, repoPath });
    expect(result.skipped).toBe("auto_upload_off");
  });

  it("skips when not due", async () => {
    enableTelemetry("http://127.0.0.1:5566");
    const handler = withTelemetry(
      dbPath,
      "search_with_fallback",
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      () => ({ warmLinesPulled: 1, baselineLines: 10 }),
    );
    await handler({ query: "seed" });
    writeTelemetryConfig({
      ...readTelemetryConfig(),
      last_upload_at: new Date().toISOString(),
    });
    const result = await maybeUploadDue({ sqlitePath: dbPath, repoPath });
    expect(result.skipped).toBe("not_due");
  });

  it("dry-runs upload when due and opted in", async () => {
    enableTelemetry("http://127.0.0.1:5566");
    const handler = withTelemetry(
      dbPath,
      "search_with_fallback",
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      () => ({
        warmLinesPulled: 5,
        baselineLines: 50,
      }),
    );
    await handler({ query: "test" });

    const result = await maybeUploadDue({ sqlitePath: dbPath, repoPath, dryRun: true, force: true });
    expect(result.ok).toBe(true);
    expect(result.uploaded).toBeGreaterThan(0);
    expect(result.skipped).toBeUndefined();
  });
});

describe("uploadDueForAllRepos", () => {
  it("returns auto_upload_off when scheduling disabled", async () => {
    enableTelemetry("http://127.0.0.1:5566");
    setAutoUpload(false);
    const results = await uploadDueForAllRepos({ repoPath });
    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe("auto_upload_off");
  });

  it("uploads explicit repo on force dry-run", async () => {
    enableTelemetry("http://127.0.0.1:5566");
    const handler = withTelemetry(
      dbPath,
      "search_with_fallback",
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      () => ({
        warmLinesPulled: 5,
        baselineLines: 50,
      }),
    );
    await handler({ query: "test" });

    const results = await uploadDueForAllRepos({ repoPath, dryRun: true, force: true });
    const uploaded = results.reduce((sum, row) => sum + row.uploaded, 0);
    expect(uploaded).toBeGreaterThan(0);
  });
});
