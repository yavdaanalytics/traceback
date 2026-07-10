import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanCursorProjects } from "../../src/adapters/cursor.js";

const GOOD_SESSION = "good-session-id";
const BAD_SESSION = "bad-session-id";

describe("cursor projects adapter (adversarial)", () => {
  let projectsRoot: string;

  beforeAll(() => {
    projectsRoot = mkdtempSync(join(tmpdir(), "traceback-cursor-projects-adv-"));
    const projectDir = join(projectsRoot, "c-source-fixture", "agent-transcripts");

    mkdirSync(join(projectDir, GOOD_SESSION), { recursive: true });
    writeFileSync(
      join(projectDir, GOOD_SESSION, `${GOOD_SESSION}.jsonl`),
      [
        JSON.stringify({
          role: "user",
          message: { content: [{ type: "text", text: "valid turn" }] },
        }),
        "NOT VALID JSON",
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "still works" }] },
        }),
      ].join("\n"),
      "utf-8",
    );

    mkdirSync(join(projectDir, BAD_SESSION), { recursive: true });
    writeFileSync(join(projectDir, BAD_SESSION, `${BAD_SESSION}.jsonl`), "", "utf-8");
  });

  it("does not abort when a jsonl line is malformed alongside good lines", () => {
    const sessions = scanCursorProjects(projectsRoot);
    const good = sessions.find((s) => s.sessionId === GOOD_SESSION);
    expect(good).toBeDefined();
    expect(good!.turns.length).toBeGreaterThanOrEqual(2);
  });

  it("skips empty transcript files", () => {
    const sessions = scanCursorProjects(projectsRoot);
    expect(sessions.find((s) => s.sessionId === BAD_SESSION)).toBeUndefined();
  });
});
