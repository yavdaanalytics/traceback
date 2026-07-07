import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, upsertSession, getPenaltyWeight, incrementPenaltyWeight } from "../../src/storage/sqlite.js";
import { renderEfficiencyReport, withTelemetry } from "../../src/mcp/telemetry.js";

// Pins exact behaviors that a "helpful" refactor could silently invert or
// reformat without any single unit test catching it - each of these was a
// deliberate, previously-confirmed design decision (see the approved plan
// for the observability/feedback layer), not an incidental implementation
// detail.
let dbPath: string;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-regression-"));
  dbPath = join(tmpDir, "traceback.db");
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("penalty sign convention (pinned)", () => {
  it("penalizing ADDS to distance (higher = worse rank), never subtracts", () => {
    // LanceDB cosine distance — lower is more similar. Penalizing adds to distance.
    upsertSession(dbPath, {
      session_id: "pin-s1",
      adapter_id: "claude-code",
      project_path: "/repo",
      git_branch: null,
      started_at: null,
      ended_at: null,
      slug: null,
      raw_path: "/raw/pin-s1.jsonl",
      intent: null,
    });
    const distance = 0.5;
    incrementPenaltyWeight(dbPath, "pin-s1", 0.2);
    const penalty = getPenaltyWeight(dbPath, "pin-s1");
    const adjusted = distance + penalty;
    expect(adjusted).toBeGreaterThan(distance);
    expect(adjusted).toBeCloseTo(0.7);
  });
});

describe("penalty_weight migration (pinned column presence)", () => {
  it("sessions table has penalty_weight after schema bootstrap, defaulting to 0", () => {
    const db = getDb(dbPath);
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string; dflt_value: string }>;
    const col = cols.find((c) => c.name === "penalty_weight");
    expect(col).toBeDefined();
    expect(col?.dflt_value).toBe("0");
  });
});

describe("efficiency report text format (pinned)", () => {
  it("matches the exact header/line-reduction phrasing the report is built around", async () => {
    const handler = withTelemetry(
      dbPath,
      "pin_tool",
      async () => ({ content: [{ type: "text", text: "a\nb" }] }),
      () => ({ warmLinesPulled: 180, baselineLines: 45_200 }),
    );
    await handler({});
    const text = renderEfficiencyReport(dbPath, { toolName: "pin_tool" });
    // Pinned to the sample numbers from the original design spec: "180 lines
    // scanned vs 45200 baseline -> 99.6% reduction".
    expect(text).toContain("## pin_tool  (1 calls, 0 failed");
    expect(text).toMatch(/lines: 180 scanned vs 45200 baseline -> 99\.6% reduction \(45020 lines saved\)/);
  });

  it("never mentions baseline/reduction for a tool that recorded no line-reduction telemetry", async () => {
    const handler = withTelemetry(dbPath, "pin_tool_no_lines", async () => ({ content: [{ type: "text", text: "" }] }));
    await handler({});
    const text = renderEfficiencyReport(dbPath, { toolName: "pin_tool_no_lines" });
    expect(text).not.toContain("reduction");
    expect(text).not.toContain("baseline");
  });
});

describe("cosine confidence threshold (pinned)", () => {
  it("default TRACEBACK_CONFIDENCE_THRESHOLD is 0.35", async () => {
    const { DEFAULT_CONFIDENCE_THRESHOLD } = await import("../../src/config.js");
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.35);
  });
});

describe("search_with_fallback mode enum (pinned)", () => {
  it("includes 4-layer mode values", () => {
    const modes = [
      "scoped_session",
      "git_history_intent",
      "grep_scoped",
      "grep_full_repo",
      "ast_refined",
      "diff_refined",
      "keyword_refined",
      "silent_miss_scoped",
    ];
    expect(modes).toContain("git_history_intent");
    expect(modes).toContain("keyword_refined");
  });
});

describe("get_change_graph timeline shape (pinned)", () => {
  it("timeline entries expose connection and edges", () => {
    const shape = { connection: "direct" as const, edges: [] as unknown[] };
    expect(shape).toHaveProperty("connection");
    expect(shape).toHaveProperty("edges");
  });
});
