import { describe, it, expect } from "vitest";
import type { Turn } from "../../src/adapters/types.js";
import {
  extractEditFiles,
  extractCommitHashCandidates,
  buildSessionLinkageMetadata,
  metadataNeedsLinkageEnrichment,
} from "../../src/ingest/session-files.js";

describe("session-files", () => {
  const turns: Turn[] = [
    {
      turnId: "t1",
      role: "assistant",
      timestamp: 0,
      toolCalls: [
        {
          toolName: "Edit",
          input: { file_path: "src/auth.ts" },
          isFileEdit: true,
          filePath: "src/auth.ts",
          isShellCommand: false,
        },
        {
          toolName: "Bash",
          input: { command: "git show abcdef0123456789abcdef0123456789abcdef0 --stat" },
          isFileEdit: false,
          isShellCommand: true,
          command: "git show abcdef0123456789abcdef0123456789abcdef0 --stat",
        },
      ],
    },
    {
      turnId: "t2",
      role: "assistant",
      timestamp: 1,
      toolCalls: [
        {
          toolName: "Write",
          input: { file_path: "src/token.ts" },
          isFileEdit: true,
          filePath: "src/token.ts",
          isShellCommand: false,
        },
      ],
    },
  ];

  it("extracts edit file paths from tool calls", () => {
    expect(extractEditFiles(turns).sort()).toEqual(["src/auth.ts", "src/token.ts"]);
  });

  it("extracts commit hash candidates from git bash commands", () => {
    const hashes = extractCommitHashCandidates(turns);
    expect(hashes).toContain("abcdef0123456789abcdef0123456789abcdef0");
  });

  it("buildSessionLinkageMetadata without repo skips hash validation", () => {
    const meta = buildSessionLinkageMetadata(
      { sessionId: "s", adapterId: "claude-code", projectPath: "/r", startedAt: 0, endedAt: 1, turns },
      undefined,
    );
    expect(meta.editFiles).toHaveLength(2);
    expect(meta.commitHashes).toEqual([]);
  });

  it("metadataNeedsLinkageEnrichment detects missing editFiles", () => {
    expect(metadataNeedsLinkageEnrichment(null)).toBe(true);
    expect(metadataNeedsLinkageEnrichment(JSON.stringify({ todos: [] }))).toBe(true);
    expect(metadataNeedsLinkageEnrichment(JSON.stringify({ editFiles: [] }))).toBe(false);
  });
});
