import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FallbackResult } from "../../src/mcp/fallback.js";
import {
  extractQueryFromStdin,
  formatWarmStartContext,
  normalizeVsCodeHookEventName,
  wrapCursorReadResponse,
  wrapVsCodeResponse,
} from "../../src/cli/warm-start-format.js";

vi.mock("../../src/mcp/fallback.js", () => ({
  searchWithFallback: vi.fn(),
}));

import { searchWithFallback } from "../../src/mcp/fallback.js";
import { runWarmStart } from "../../src/cli/warm-start.js";

const sampleResult: FallbackResult = {
  mode: "scoped_session",
  grep_result: "src/a.ts:10:match\n",
  layers: [{ layer: 1, tool: "find_similar_sessions", certainty: "probabilistic", mode: "scoped_session" }],
  session_matches: [{ session_id: "sess-1", _distance: 0.2 }],
  git_scope: [{ commit_hash: "abc123def456", files_changed: ["src/a.ts"], signals: ["pickaxe"] }],
  source_labels: ["session_vector"],
  source_label: "session_vector",
};

describe("formatWarmStartContext", () => {
  it("formats sessions, git scope, and grep hits", () => {
    const text = formatWarmStartContext(sampleResult);
    expect(text).toContain("sess-1");
    expect(text).toContain("abc123def456");
    expect(text).toContain("src/a.ts:10:match");
    expect(text).toContain("scoped_session");
  });
});

describe("stdin query extraction", () => {
  it("reads vscode UserPromptSubmit prompt", () => {
    expect(extractQueryFromStdin("vscode", { hook_event_name: "UserPromptSubmit", prompt: "fix jwt bug" })).toBe(
      "fix jwt bug",
    );
  });

  it("reads vscode PreToolUse file path", () => {
    expect(
      extractQueryFromStdin("vscode", {
        hook_event_name: "PreToolUse",
        tool_input: { file_path: "src/auth.ts" },
      }),
    ).toBe("src/auth.ts");
  });

  it("reads cursor-read file_path", () => {
    expect(extractQueryFromStdin("cursor-read", { file_path: "src/db.ts" })).toBe("src/db.ts");
  });

  it("reads windsurf user_prompt", () => {
    expect(
      extractQueryFromStdin("windsurf", { tool_info: { user_prompt: "why is pool exhausted" } }),
    ).toBe("why is pool exhausted");
  });
});

describe("host response wrappers", () => {
  it("wraps vscode additionalContext", () => {
    const out = JSON.parse(wrapVsCodeResponse("UserPromptSubmit", "ctx"));
    expect(out.hookSpecificOutput.additionalContext).toBe("ctx");
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });

  it("wraps cursor additional_context", () => {
    const out = JSON.parse(wrapCursorReadResponse("ctx"));
    expect(out.additional_context).toBe("ctx");
  });

  it("normalizes hook event names", () => {
    expect(normalizeVsCodeHookEventName("userPromptSubmitted")).toBe("UserPromptSubmit");
    expect(normalizeVsCodeHookEventName("preToolUse")).toBe("PreToolUse");
  });
});

describe("runWarmStart", () => {
  beforeEach(() => {
    vi.mocked(searchWithFallback).mockReset();
    vi.mocked(searchWithFallback).mockResolvedValue(sampleResult);
  });

  it("returns plain JSON for plain format", async () => {
    const out = await runWarmStart({ format: "plain", repoPath: process.cwd(), query: "jwt bug" });
    const parsed = JSON.parse(out);
    expect(parsed.data.mode).toBe("scoped_session");
    expect(parsed.context).toContain("sess-1");
  });

  it("returns vscode hook JSON", async () => {
    const out = await runWarmStart({
      format: "vscode",
      repoPath: process.cwd(),
      query: "jwt bug",
      stdin: { hook_event_name: "UserPromptSubmit" },
    });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("sess-1");
  });

  it("returns cursor-read hook JSON", async () => {
    const out = await runWarmStart({
      format: "cursor-read",
      repoPath: process.cwd(),
      stdin: { file_path: "src/x.ts" },
    });
    const parsed = JSON.parse(out);
    expect(parsed.additional_context).toContain("sess-1");
  });

  it("returns windsurf plain text", async () => {
    const out = await runWarmStart({
      format: "windsurf",
      repoPath: process.cwd(),
      stdin: { tool_info: { user_prompt: "db pool" } },
    });
    expect(out).toContain("sess-1");
    expect(() => JSON.parse(out)).toThrow();
  });
});
