import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";

describe("claude-code adapter", () => {
  let adapter: ClaudeCodeAdapter;

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), "traceback-claude-"));
    const projectDir = join(root, "c--source-fixture");
    mkdirSync(join(projectDir, "sessions"), { recursive: true });
    cpSync(
      join(process.cwd(), "tests/fixtures/claude/fixture-session.jsonl"),
      join(projectDir, "sessions", "fixture-session.jsonl"),
    );
    process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = root;
    adapter = new ClaudeCodeAdapter();
  });

  it("discovers sessions from sessions/ subfolder", () => {
    const refs = adapter.discover();
    expect(refs.some((r) => r.sessionId === "fixture-session")).toBe(true);
  });

  it("parse sets transcriptRef to jsonl path", () => {
    const refs = adapter.discover();
    const ref = refs.find((r) => r.sessionId === "fixture-session");
    expect(ref).toBeDefined();
    const session = adapter.parse(ref!);
    expect(session.transcriptRef).toContain("fixture-session.jsonl");
    expect(session.turns.length).toBeGreaterThan(0);
  });
});
