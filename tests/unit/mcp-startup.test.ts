import { describe, it, expect, vi, afterEach } from "vitest";
import { scheduleAutoUploadDue } from "../../src/mcp/startup.js";
import * as autoUpload from "../../src/telemetry/auto-upload.js";

describe("scheduleAutoUploadDue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs failure result returned from maybeUploadDue", async () => {
    const maybeSpy = vi
      .spyOn(autoUpload, "maybeUploadDue")
      .mockResolvedValue({ ok: false, uploaded: 0, endpoint: "http://localhost", error: "network down" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleAutoUploadDue({ sqlitePath: "/tmp/db.sqlite", repoPath: "/tmp/repo" });
    await Promise.resolve();
    await Promise.resolve();

    expect(maybeSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith("traceback-telemetry: auto-upload failed: network down");
  });

  it("catches rejected maybeUploadDue promise and logs crash message", async () => {
    const maybeSpy = vi.spyOn(autoUpload, "maybeUploadDue").mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleAutoUploadDue({ sqlitePath: "/tmp/db.sqlite", repoPath: "/tmp/repo" });
    await Promise.resolve();
    await Promise.resolve();

    expect(maybeSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith("traceback-telemetry: auto-upload crashed: boom");
  });
});
