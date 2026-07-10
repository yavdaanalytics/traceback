import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanCopilotSessionState } from "../../src/adapters/copilot.js";

const GOOD_SESSION = "good-copilot-session";
const BAD_SESSION = "bad-copilot-session";
const NO_YAML_SESSION = "no-yaml-session";

describe("copilot session-state adapter (adversarial)", () => {
  let stateRoot: string;

  beforeAll(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "traceback-copilot-state-adv-"));

    const goodDir = join(stateRoot, GOOD_SESSION);
    mkdirSync(goodDir, { recursive: true });
    writeFileSync(
      join(goodDir, "workspace.yaml"),
      "git_root: C:\\source\\fixture\n",
      "utf-8",
    );
    writeFileSync(
      join(goodDir, "events.jsonl"),
      [
        JSON.stringify({
          type: "user.message",
          data: { content: "valid user message" },
          timestamp: "2026-03-25T04:00:00.000Z",
        }),
        "NOT JSON",
        JSON.stringify({
          type: "assistant.reply",
          data: { content: "valid assistant reply" },
          timestamp: "2026-03-25T04:00:01.000Z",
        }),
      ].join("\n"),
      "utf-8",
    );

    const badDir = join(stateRoot, BAD_SESSION);
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "workspace.yaml"), "git_root: C:\\source\\fixture\n", "utf-8");
    writeFileSync(join(badDir, "events.jsonl"), "", "utf-8");

    const noYamlDir = join(stateRoot, NO_YAML_SESSION);
    mkdirSync(noYamlDir, { recursive: true });
    writeFileSync(
      join(noYamlDir, "events.jsonl"),
      JSON.stringify({
        type: "user.message",
        data: { content: "no yaml still works" },
        timestamp: "2026-03-25T04:01:00.000Z",
      }),
      "utf-8",
    );
  });

  it("does not abort when events.jsonl has a malformed line", () => {
    const sessions = scanCopilotSessionState(stateRoot);
    const good = sessions.find((s) => s.sessionId === GOOD_SESSION);
    expect(good).toBeDefined();
    expect(good!.turns.length).toBeGreaterThanOrEqual(2);
  });

  it("skips empty events files", () => {
    const sessions = scanCopilotSessionState(stateRoot);
    expect(sessions.find((s) => s.sessionId === BAD_SESSION)).toBeUndefined();
  });

  it("falls back to session folder id when workspace.yaml is missing", () => {
    const sessions = scanCopilotSessionState(stateRoot);
    const noYaml = sessions.find((s) => s.sessionId === NO_YAML_SESSION);
    expect(noYaml).toBeDefined();
    expect(noYaml!.projectPath).toBe(NO_YAML_SESSION);
  });
});
