import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CopilotAdapter } from "../../src/adapters/copilot.js";

describe("copilot adapter adversarial vscdb fallback", () => {
  let storageRoot: string;
  let adapter: CopilotAdapter;
  const savedCopilotStorage = process.env.TRACEBACK_COPILOT_STORAGE;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "traceback-copilot-adv-"));
    const globalDir = join(storageRoot, "globalStorage");
    mkdirSync(globalDir, { recursive: true });
    const globalDb = join(globalDir, "state.vscdb");
    const db = new DatabaseSync(globalDb);
    db.exec(`CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)`);
    db.prepare(`INSERT OR REPLACE INTO ItemTable (key, value) VALUES ($key, $value)`).run({
      key: "interactive.sessions",
      value: null,
    });

    process.env.TRACEBACK_COPILOT_STORAGE = storageRoot;
    adapter = new CopilotAdapter();
  });

  afterAll(() => {
    if (savedCopilotStorage === undefined) delete process.env.TRACEBACK_COPILOT_STORAGE;
    else process.env.TRACEBACK_COPILOT_STORAGE = savedCopilotStorage;
    try {
      rmSync(storageRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("listSessions does not throw when global ItemTable.value is NULL", () => {
    expect(() => adapter.listSessions()).not.toThrow();
    expect(Array.isArray(adapter.discover())).toBe(true);
  });
});
