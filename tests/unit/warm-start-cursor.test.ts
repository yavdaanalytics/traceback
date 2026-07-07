import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isBlockedPreTool,
  isTracebackSearchTool,
  isWarmStarted,
  markWarmStarted,
  runCursorMcpMark,
  runCursorWarmGate,
  warmMarkerPath,
} from "../../src/cli/warm-start-cursor.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "traceback-warm-cursor-"));
});

afterEach(() => {
  try {
    rmSync(repoRoot, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("warm-start cursor gate", () => {
  it("allows non-grep tools without a marker", () => {
    const out = JSON.parse(
      runCursorWarmGate({
        repoPath: repoRoot,
        stdin: { generation_id: "gen-1", tool_name: "Read" },
        callServerId: "user-traceback",
      }),
    );
    expect(out.permission).toBe("allow");
  });

  it("denies Grep until search_with_fallback marker exists", () => {
    const denied = JSON.parse(
      runCursorWarmGate({
        repoPath: repoRoot,
        stdin: { generation_id: "gen-1", tool_name: "Grep" },
        callServerId: "user-traceback",
      }),
    );
    expect(denied.permission).toBe("deny");
    expect(denied.agent_message).toContain("search_with_fallback");

    markWarmStarted(repoRoot, "gen-1");
    const allowed = JSON.parse(
      runCursorWarmGate({
        repoPath: repoRoot,
        stdin: { generation_id: "gen-1", tool_name: "Grep" },
        callServerId: "user-traceback",
      }),
    );
    expect(allowed.permission).toBe("allow");
    expect(existsSync(warmMarkerPath(repoRoot, "gen-1"))).toBe(true);
  });

  it("marks warm-start after traceback MCP tool", () => {
    runCursorMcpMark({
      repoPath: repoRoot,
      stdin: { generation_id: "gen-2", tool_name: "search_with_fallback" },
    });
    expect(isWarmStarted(repoRoot, "gen-2")).toBe(true);
  });

  it("classifies tool names", () => {
    expect(isBlockedPreTool("Grep")).toBe(true);
    expect(isBlockedPreTool("Glob")).toBe(true);
    expect(isBlockedPreTool("Read")).toBe(false);
    expect(isTracebackSearchTool("search_with_fallback")).toBe(true);
    expect(isTracebackSearchTool("MCP:user-traceback:search_with_fallback")).toBe(true);
  });
});
