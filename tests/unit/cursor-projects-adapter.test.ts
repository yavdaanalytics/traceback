import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CursorAdapter,
  buildCursorProjectsTranscriptFixture,
} from "../../src/adapters/cursor.js";
import { normalizePath } from "../../src/util/paths.js";

const SESSION_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("cursor adapter (projects / agent-transcripts)", () => {
  let projectsRoot: string;
  let adapter: CursorAdapter;

  beforeAll(() => {
    projectsRoot = mkdtempSync(join(tmpdir(), "traceback-cursor-projects-"));
    buildCursorProjectsTranscriptFixture(projectsRoot, "c-source-fixture", SESSION_ID, [
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "Hello from agent transcript" }] },
      }),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [
            { type: "text", text: "Reply from assistant" },
            { type: "tool_use", name: "Read", input: { path: "src/foo.ts" } },
          ],
        },
      }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
    ]);
    process.env.TRACEBACK_CURSOR_PROJECTS_DIR = projectsRoot;
    process.env.TRACEBACK_CURSOR_STORAGE = join(projectsRoot, "no-vscdb-storage");
    adapter = new CursorAdapter();
  });

  it("is available via projects path without AppData vscdb", () => {
    expect(adapter.isAvailable()).toBe(true);
  });

  it("discovers agent-transcript sessions", () => {
    const refs = adapter.discover();
    expect(refs.some((r) => r.sessionId === SESSION_ID)).toBe(true);
    const ref = refs.find((r) => r.sessionId === SESSION_ID)!;
    expect(normalizePath(ref.projectPath)).toBe(normalizePath("c:/source/fixture"));
    expect(ref.transcriptPath).toContain(".jsonl");
  });

  it("parse loads turns and tool calls from jsonl", () => {
    const ref = adapter.discover().find((r) => r.sessionId === SESSION_ID)!;
    const session = adapter.parse(ref);
    expect(session.turns.length).toBe(2);
    expect(session.turns[1].toolCalls.length).toBe(1);
    expect(session.turns[1].toolCalls[0].toolName).toBe("Read");
  });
});
