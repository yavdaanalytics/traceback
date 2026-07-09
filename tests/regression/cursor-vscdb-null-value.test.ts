import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CursorAdapter,
  buildCursorFixtureVscdbNullValue,
} from "../../src/adapters/cursor.js";

/**
 * Pins regression for ingest hook failure since 2026-07-07:
 * NULL ItemTable.value caused `row.value.toString` TypeError and aborted ingestion.
 */
describe("regression: cursor vscdb NULL value (2026-07-07)", () => {
  let storageRoot: string;
  const savedCursorStorage = process.env.TRACEBACK_CURSOR_STORAGE;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "traceback-cursor-null-reg-"));
    const hash = "only-null-ws";
    const wsDir = join(storageRoot, "workspaceStorage", hash);
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(
      join(wsDir, "workspace.json"),
      JSON.stringify({ folder: "file:///c:/source/regression" }),
    );
    buildCursorFixtureVscdbNullValue(wsDir, "composer.composerData");
    process.env.TRACEBACK_CURSOR_STORAGE = storageRoot;
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

  it("listSessions tolerates NULL composer.composerData without TypeError", () => {
    const adapter = new CursorAdapter();
    expect(() => adapter.listSessions()).not.toThrow();
    expect(adapter.listSessions()).toEqual([]);
  });
});
