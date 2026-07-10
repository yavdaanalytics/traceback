import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CursorAdapter, buildCursorFixtureVscdb } from "../../src/adapters/cursor.js";

describe("cursor adapter (fixture)", () => {
  let storageRoot: string;
  let adapter: CursorAdapter;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "traceback-cursor-fix-"));
    const hash = "abc123";
    const wsDir = join(storageRoot, "workspaceStorage", hash);
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(
      join(wsDir, "workspace.json"),
      JSON.stringify({ folder: "file:///c:/source/fixture" }),
    );
    buildCursorFixtureVscdb(wsDir, {
      composerId: "composer-fixture-1",
      conversation: [
        { type: "user", text: "Hello from Cursor fixture", bubbleId: "b1", timestamp: 1000 },
        { type: "assistant", text: "Reply from assistant", bubbleId: "b2", timestamp: 2000 },
      ],
    });
    process.env.TRACEBACK_CURSOR_STORAGE = storageRoot;
    process.env.TRACEBACK_CURSOR_PROJECTS_DIR = join(storageRoot, "no-cursor-projects");
    adapter = new CursorAdapter();
  });

  it("discovers composer sessions from fixture vscdb", () => {
    expect(adapter.isAvailable()).toBe(true);
    const refs = adapter.discover();
    expect(refs.some((r) => r.sessionId === "composer-fixture-1")).toBe(true);
  });

  it("parse loads turns from fixture", () => {
    const ref = adapter.discover().find((r) => r.sessionId === "composer-fixture-1");
    expect(ref).toBeDefined();
    const session = adapter.parse(ref!);
    expect(session.turns.length).toBe(2);
    expect(session.transcriptRef).toContain("state.vscdb");
  });
});
