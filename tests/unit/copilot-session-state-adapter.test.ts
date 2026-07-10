import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CopilotAdapter } from "../../src/adapters/copilot.js";
import { normalizePath } from "../../src/util/paths.js";

const SESSION_ID = "0145501c-4f5f-42b5-91a9-3efc3a95ed55";

describe("copilot adapter (session-state)", () => {
  let stateRoot: string;
  let adapter: CopilotAdapter;

  beforeAll(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "traceback-copilot-state-"));
    const sessionDir = join(stateRoot, SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });

    writeFileSync(
      join(sessionDir, "workspace.yaml"),
      [
        `id: ${SESSION_ID}`,
        "cwd: C:\\source\\fixture",
        "git_root: C:\\source\\fixture",
        "branch: main",
      ].join("\n"),
      "utf-8",
    );

    writeFileSync(
      join(sessionDir, "events.jsonl"),
      [
        JSON.stringify({
          type: "session.start",
          data: { sessionId: SESSION_ID },
          timestamp: "2026-03-25T03:58:08.149Z",
        }),
        JSON.stringify({
          type: "user.message",
          data: { content: "Fix OAuth authentication flow" },
          timestamp: "2026-03-25T03:58:11.781Z",
        }),
        JSON.stringify({
          type: "assistant.message",
          data: { content: "I will inspect the auth module" },
          timestamp: "2026-03-25T03:58:12.000Z",
        }),
      ].join("\n"),
      "utf-8",
    );

    process.env.TRACEBACK_COPILOT_SESSION_STATE_DIR = stateRoot;
    process.env.TRACEBACK_COPILOT_STORAGE = join(stateRoot, "no-vscode-storage");
    adapter = new CopilotAdapter();
  });

  it("discovers session-state events", () => {
    const refs = adapter.discover();
    expect(refs.some((r) => r.sessionId === SESSION_ID)).toBe(true);
    const ref = refs.find((r) => r.sessionId === SESSION_ID)!;
    expect(normalizePath(ref.projectPath)).toBe(normalizePath("C:/source/fixture"));
    expect(ref.transcriptPath).toContain("events.jsonl");
  });

  it("parse loads user and assistant turns", () => {
    const ref = adapter.discover().find((r) => r.sessionId === SESSION_ID)!;
    const session = adapter.parse(ref);
    expect(session.turns.length).toBe(2);
    expect(session.turns[0].role).toBe("user");
    expect(session.turns[0].text).toContain("OAuth");
  });
});
