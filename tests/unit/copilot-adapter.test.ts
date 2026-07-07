import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CopilotAdapter } from "../../src/adapters/copilot.js";

describe("copilot adapter (fixture)", () => {
  let storageRoot: string;
  let adapter: CopilotAdapter;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "traceback-copilot-fix-"));
    const hash = "copilothash";
    const chatDir = join(storageRoot, "workspaceStorage", hash, "chatSessions");
    mkdirSync(chatDir, { recursive: true });
    cpSync(
      join(process.cwd(), "tests/fixtures/copilot/copilot-fixture-1.json"),
      join(chatDir, "copilot-fixture-1.json"),
    );
    writeFileSync(
      join(storageRoot, "workspaceStorage", hash, "workspace.json"),
      JSON.stringify({ folder: "file:///c:/source/fixture" }),
    );
    process.env.TRACEBACK_COPILOT_STORAGE = storageRoot;
    adapter = new CopilotAdapter();
  });

  it("discovers chat session json files", () => {
    const refs = adapter.discover();
    expect(refs.some((r) => r.sessionId === "copilot-fixture-1")).toBe(true);
  });

  it("parse loads user/assistant turns", () => {
    const ref = adapter.discover().find((r) => r.sessionId === "copilot-fixture-1");
    const session = adapter.parse(ref!);
    expect(session.turns.length).toBeGreaterThanOrEqual(2);
  });
});
