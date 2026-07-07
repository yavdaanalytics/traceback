import { describe, it, expect } from "vitest";
import { segmentTurns, segmentSession, DEFAULT_SESSION_GAP_MS } from "../../src/ingest/segmentation.js";
import type { ParsedSession, Turn } from "../../src/adapters/types.js";

describe("segmentation", () => {
  const turns: Turn[] = [
    { turnId: "t1", role: "user", timestamp: 0, toolCalls: [], text: "a" },
    { turnId: "t2", role: "assistant", timestamp: 60_000, toolCalls: [], text: "b" },
    { turnId: "t3", role: "user", timestamp: DEFAULT_SESSION_GAP_MS + 120_000, toolCalls: [], text: "c" },
  ];

  it("splits turns on time gap", () => {
    const segments = segmentTurns(turns, DEFAULT_SESSION_GAP_MS);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(1);
  });

  it("assigns synthetic session ids per segment", () => {
    const session: ParsedSession = {
      sessionId: "base",
      adapterId: "claude-code",
      projectPath: "/repo",
      startedAt: 0,
      endedAt: DEFAULT_SESSION_GAP_MS + 120_000,
      turns,
    };
    const out = segmentSession(session, { transcriptRef: "/raw/base.jsonl", sourceFileKey: "claude-code:base" });
    expect(out).toHaveLength(2);
    expect(out[0].sessionId).toBe("base:seg-0");
    expect(out[1].sessionId).toBe("base:seg-1");
    expect(out[0].transcriptRef).toBe("/raw/base.jsonl");
  });
});
