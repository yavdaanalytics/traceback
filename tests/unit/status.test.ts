import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getTracebackStatus } from "../../src/mcp/status.js";

describe("get_traceback_status", () => {
  it("returns discovery hints and tool counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "traceback-status-"));
    const status = getTracebackStatus(join(dir, "traceback.db"), dir, join(dir, "data"));
    expect(status.enabled).toBe(true);
    expect(status.tools_count).toBeGreaterThan(0);
    expect(status.discovery.recommended_first_tools).toContain("search_with_fallback");
  });
});

