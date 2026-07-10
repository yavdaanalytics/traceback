import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";
import { normalizePath } from "../../src/util/paths.js";
import { decodeClaudeProjectDir, encodeClaudeProjectDir } from "../../src/adapters/path-encoding.js";
import {
  installPromptCaptureFixture,
  PROMPT_CAPTURE_SESSION_ID,
  type PromptCaptureFixture,
} from "../helpers/prompt-capture-fixture.js";

let fixture: PromptCaptureFixture;

beforeAll(() => {
  fixture = installPromptCaptureFixture();
});

afterAll(() => {
  try {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("prompt capture fixture", () => {
  it("round-trips Claude project path encoding", () => {
    const encoded = encodeClaudeProjectDir(fixture.repoDir);
    expect(normalizePath(decodeClaudeProjectDir(encoded))).toBe(normalizePath(fixture.repoDir));
  });

  it("claude adapter discovers the fixture session", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.isAvailable()).toBe(true);
    const refs = adapter.discover();
    expect(refs.some((r) => r.sessionId === PROMPT_CAPTURE_SESSION_ID)).toBe(true);
    const ref = refs.find((r) => r.sessionId === PROMPT_CAPTURE_SESSION_ID)!;
    expect(normalizePath(ref.projectPath)).toBe(normalizePath(fixture.repoDir));
    const session = adapter.parse(ref);
    expect(session.turns.length).toBeGreaterThan(0);
  });
});
