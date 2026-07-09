import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CursorAdapter,
  buildCursorFixtureVscdb,
  buildCursorFixtureVscdbNullValue,
} from "../../src/adapters/cursor.js";

describe("cursor adapter adversarial vscdb", () => {
  let storageRoot: string;
  let adapter: CursorAdapter;
  const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "traceback-cursor-adv-"));
    const folderUri = "file:///c:/source/adversarial-fixture";

    const poisonHash = "ws-poison-null";
    const goodHash = "ws-good-data";
    const poisonDir = join(storageRoot, "workspaceStorage", poisonHash);
    const goodDir = join(storageRoot, "workspaceStorage", goodHash);

    for (const dir of [poisonDir, goodDir]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "workspace.json"), JSON.stringify({ folder: folderUri }), "utf-8");
    }

    buildCursorFixtureVscdbNullValue(poisonDir, "composer.composerData");
    buildCursorFixtureVscdb(goodDir, {
      composerId: "adversarial-good-session",
      conversation: [
        { type: "user", text: "hello", bubbleId: "a1", timestamp: Date.now() - 1000 },
        { type: "assistant", text: "world", bubbleId: "a2", timestamp: Date.now() },
      ],
    });

    process.env.TRACEBACK_CURSOR_STORAGE = storageRoot;
    adapter = new CursorAdapter();
  });

  afterAll(() => {
    if (savedCursorStorage === undefined) delete process.env.TRACEBACK_CURSOR_STORAGE;
    else process.env.TRACEBACK_CURSOR_STORAGE = savedCursorStorage;
    try {
      rmSync(storageRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("listSessions does not throw when a workspace has NULL ItemTable.value", () => {
    expect(() => adapter.listSessions()).not.toThrow();
  });

  it("discovers the valid session when another workspace has NULL values", () => {
    const refs = adapter.discover();
    expect(refs.some((r) => r.sessionId === "adversarial-good-session")).toBe(true);
  });

  it("skips NULL cursorDiskKV rows in global storage scan", () => {
    const globalDir = join(storageRoot, "globalStorage");
    mkdirSync(globalDir, { recursive: true });
    const globalDb = join(globalDir, "state.vscdb");
    const db = new DatabaseSync(globalDb);
    db.exec(`CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)`);
    db.prepare(`INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES ($key, $value)`).run({
      key: "composerData:null-global",
      value: null,
    });

    expect(() => adapter.listSessions()).not.toThrow();
    const refs = adapter.discover();
    expect(refs.some((r) => r.sessionId === "adversarial-good-session")).toBe(true);
  });
});
