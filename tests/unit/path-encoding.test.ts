import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  decodeClaudeProjectDir,
  decodeCursorProjectDir,
  encodeClaudeProjectDir,
  encodeCursorProjectDir,
  hasCursorProjectsTranscripts,
} from "../../src/adapters/path-encoding.js";
import { normalizePath } from "../../src/util/paths.js";

describe("encodeClaudeProjectDir / decodeClaudeProjectDir", () => {
  it("round-trips when the project directory exists on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "tb-claude-encode-"));
    const projectPath = join(root, "powerbi-embedded-analytics");
    mkdirSync(projectPath, { recursive: true });

    const encoded = encodeClaudeProjectDir(projectPath);
    if (process.platform === "win32") {
      expect(encoded).toContain("--");
    } else {
      expect(encoded.startsWith("-")).toBe(true);
    }
    expect(normalizePath(decodeClaudeProjectDir(encoded))).toBe(normalizePath(projectPath));
  });

  it("decodes c--source form when path exists", () => {
    const root = mkdtempSync(join(tmpdir(), "tb-claude-decode-"));
    const projectPath = join(root, "source", "powerbi-embedded-analytics");
    mkdirSync(projectPath, { recursive: true });

    const encoded = encodeClaudeProjectDir(projectPath);
    expect(normalizePath(decodeClaudeProjectDir(encoded))).toBe(normalizePath(projectPath));
  });

  it("keeps literal leading-dash names when no Unix path exists", () => {
    // Invented `/weird/name` would break round-tripping for a real folder named `-weird-name`.
    expect(decodeClaudeProjectDir("-weird-name")).toBe("-weird-name");
    expect(decodeClaudeProjectDir("-")).toBe("-");
  });
});

describe("encodeCursorProjectDir / decodeCursorProjectDir", () => {
  it("round-trips when the project directory exists on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "tb-cursor-encode-"));
    const projectPath = join(root, "powerbi-embedded-analytics");
    mkdirSync(projectPath, { recursive: true });

    const encoded = encodeCursorProjectDir(projectPath);
    expect(normalizePath(decodeCursorProjectDir(encoded))).toBe(normalizePath(projectPath));
  });

  it("decodes short c-source form when path exists", () => {
    const root = mkdtempSync(join(tmpdir(), "tb-cursor-decode-short-"));
    const projectPath = join(root, "source", "powerbi-embedded-analytics");
    mkdirSync(projectPath, { recursive: true });

    const encoded = encodeCursorProjectDir(projectPath);
    expect(normalizePath(decodeCursorProjectDir(encoded))).toBe(normalizePath(projectPath));
  });

  it("decodes long Users path form when path exists", () => {
    const root = mkdtempSync(join(tmpdir(), "tb-cursor-decode-long-"));
    const projectPath = join(root, "Users", "AmitMohanty", "source", "powerbi-embedded-analytics");
    mkdirSync(projectPath, { recursive: true });

    const encoded = encodeCursorProjectDir(projectPath);
    expect(normalizePath(decodeCursorProjectDir(encoded))).toBe(normalizePath(projectPath));
  });

  it("returns dirName unchanged when pattern does not match", () => {
    expect(decodeCursorProjectDir("empty-window")).toBe("empty-window");
    expect(decodeCursorProjectDir("1772373489507")).toBe("1772373489507");
  });

  it("keeps literal leading-dash names when no Unix path exists", () => {
    expect(decodeCursorProjectDir("-weird-name")).toBe("-weird-name");
  });
});

describe("hasCursorProjectsTranscripts", () => {
  it("returns true when agent-transcripts exists under a project folder", () => {
    const root = mkdtempSync(join(tmpdir(), "tb-cursor-projects-"));
    mkdirSync(join(root, "c-source-fixture", "agent-transcripts", "sess-1"), { recursive: true });
    expect(hasCursorProjectsTranscripts(root)).toBe(true);
  });

  it("returns false when root has no agent-transcripts trees", () => {
    const root = mkdtempSync(join(tmpdir(), "tb-cursor-projects-empty-"));
    mkdirSync(join(root, "c-source-fixture", "terminals"), { recursive: true });
    expect(hasCursorProjectsTranscripts(root)).toBe(false);
  });
});
