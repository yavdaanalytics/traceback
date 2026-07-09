import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serverEntry, promptTelemetryOptIn } from "../../src/cli/setup.js";
import {
  DEFAULT_TELEMETRY_ENDPOINT,
  TELEMETRY_COLLECTED_LINES,
  TELEMETRY_NEVER_COLLECTED_LINES,
  telemetryOptOutInstructions,
} from "../../src/telemetry/disclosure.js";
import { readTelemetryConfig } from "../../src/telemetry/config.js";

describe("setup telemetry", () => {
  it("serverEntry without plugin omits telemetry env", () => {
    const entry = serverEntry("traceback") as { env: Record<string, string> };
    expect(entry.env.TRACEBACK_TELEMETRY_OPT_IN).toBeUndefined();
    expect(entry.env.TRACEBACK_TELEMETRY_ENDPOINT).toBeUndefined();
  });

  it("serverEntry with pluginInstall sets telemetry env", () => {
    const entry = serverEntry("traceback", { pluginInstall: true }) as { env: Record<string, string> };
    expect(entry.env.TRACEBACK_TELEMETRY_OPT_IN).toBe("true");
    expect(entry.env.TRACEBACK_TELEMETRY_ENDPOINT).toBe(DEFAULT_TELEMETRY_ENDPOINT);
  });

  it("disclosure exports collected and never-collected lines", () => {
    expect(TELEMETRY_COLLECTED_LINES.length).toBeGreaterThan(0);
    expect(TELEMETRY_NEVER_COLLECTED_LINES.length).toBeGreaterThan(0);
    expect(telemetryOptOutInstructions().join(" ")).toContain("traceback-telemetry disable");
    expect(TELEMETRY_NEVER_COLLECTED_LINES.join(" ")).toMatch(/Never|queries|transcripts/i);
  });
});

describe("promptTelemetryOptIn", () => {
  let tmpDir: string;
  let configPath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "traceback-setup-telemetry-"));
    configPath = join(tmpDir, "telemetry.json");
    process.env.TRACEBACK_TELEMETRY_CONFIG_PATH = configPath;
    delete process.env.TRACEBACK_TELEMETRY_OPT_IN;
    delete process.env.TRACEBACK_TELEMETRY_ENDPOINT;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.TRACEBACK_TELEMETRY_CONFIG_PATH;
    delete process.env.TRACEBACK_TELEMETRY_OPT_IN;
    delete process.env.TRACEBACK_TELEMETRY_ENDPOINT;
    logSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("non-interactive plugin default enables telemetry with public endpoint", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });

    await promptTelemetryOptIn({ defaultOptIn: true });

    const config = readTelemetryConfig();
    expect(config.opt_in).toBe(true);
    expect(config.auto_upload).toBe(true);
    expect(config.endpoint).toBe(DEFAULT_TELEMETRY_ENDPOINT);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Never collected:"));

    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });

  it("non-interactive plain default leaves telemetry disabled", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });

    await promptTelemetryOptIn({ defaultOptIn: false });

    const config = readTelemetryConfig();
    expect(config.opt_in).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Plain setup default"));

    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });
});
