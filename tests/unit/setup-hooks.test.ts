import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  setupCursorHooks,
  setupVsCodeHooks,
  setupWindsurfHooks,
  TRACEBACK_RULE_MARKER,
  warmStartScriptPath,
} from "../../src/cli/setup.js";

let repoRoot: string;
const fakeDist = "C:/fake/traceback/dist";

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "traceback-setup-hooks-"));
});

afterEach(() => {
  try {
    rmSync(repoRoot, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

describe("setupCursorHooks", () => {
  it("skips when .cursor/mcp.json is absent", () => {
    setupCursorHooks(repoRoot, fakeDist);
    expect(existsSync(join(repoRoot, ".cursor", "hooks.json"))).toBe(false);
  });

  it("adds beforeReadFile hook and traceback rule", () => {
    mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
    writeJson(join(repoRoot, ".cursor", "mcp.json"), { mcpServers: {} });

    setupCursorHooks(repoRoot, fakeDist);

    const hooks = JSON.parse(readFileSync(join(repoRoot, ".cursor", "hooks.json"), "utf-8"));
    expect(hooks.hooks.beforeReadFile).toHaveLength(1);
    expect(hooks.hooks.beforeReadFile[0].command).toContain("warm-start.js");
    expect(hooks.hooks.beforeReadFile[0].command).toContain("cursor-read");

    const rule = readFileSync(join(repoRoot, ".cursor", "rules", "traceback.mdc"), "utf-8");
    expect(rule).toContain(TRACEBACK_RULE_MARKER);
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain("search_with_fallback");
  });

  it("is idempotent on second run", () => {
    mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
    writeJson(join(repoRoot, ".cursor", "mcp.json"), { mcpServers: {} });

    setupCursorHooks(repoRoot, fakeDist);
    const firstHooks = readFileSync(join(repoRoot, ".cursor", "hooks.json"), "utf-8");
    setupCursorHooks(repoRoot, fakeDist);
    const secondHooks = readFileSync(join(repoRoot, ".cursor", "hooks.json"), "utf-8");
    expect(JSON.parse(secondHooks).hooks.beforeReadFile).toHaveLength(1);
    expect(secondHooks).toBe(firstHooks);
  });

  it("preserves unrelated cursor hooks", () => {
    mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
    writeJson(join(repoRoot, ".cursor", "mcp.json"), { mcpServers: {} });
    writeJson(join(repoRoot, ".cursor", "hooks.json"), {
      version: 1,
      hooks: { stop: [{ command: "./hooks/audit.sh" }] },
    });

    setupCursorHooks(repoRoot, fakeDist);

    const hooks = JSON.parse(readFileSync(join(repoRoot, ".cursor", "hooks.json"), "utf-8"));
    expect(hooks.hooks.stop).toHaveLength(1);
    expect(hooks.hooks.beforeReadFile).toHaveLength(1);
  });
});

describe("setupVsCodeHooks", () => {
  it("skips when .vscode/mcp.json is absent", () => {
    setupVsCodeHooks(repoRoot, fakeDist);
    expect(existsSync(join(repoRoot, ".github", "hooks", "traceback-warmstart.json"))).toBe(false);
  });

  it("writes UserPromptSubmit and PreToolUse hooks", () => {
    mkdirSync(join(repoRoot, ".vscode"), { recursive: true });
    writeJson(join(repoRoot, ".vscode", "mcp.json"), { servers: {} });

    setupVsCodeHooks(repoRoot, fakeDist);

    const hooks = JSON.parse(
      readFileSync(join(repoRoot, ".github", "hooks", "traceback-warmstart.json"), "utf-8"),
    );
    expect(hooks.hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.hooks.PreToolUse).toHaveLength(1);
    expect(hooks.hooks.UserPromptSubmit[0].command).toContain("warm-start.js");
    expect(hooks.hooks.PreToolUse[0].matcher).toBe("Read");
  });

  it("does not duplicate hooks on second run", () => {
    mkdirSync(join(repoRoot, ".vscode"), { recursive: true });
    writeJson(join(repoRoot, ".vscode", "mcp.json"), { servers: {} });

    setupVsCodeHooks(repoRoot, fakeDist);
    setupVsCodeHooks(repoRoot, fakeDist);

    const hooks = JSON.parse(
      readFileSync(join(repoRoot, ".github", "hooks", "traceback-warmstart.json"), "utf-8"),
    );
    expect(hooks.hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.hooks.PreToolUse).toHaveLength(1);
  });
});

describe("setupWindsurfHooks", () => {
  it("skips when .windsurf is absent", () => {
    setupWindsurfHooks(repoRoot, fakeDist);
    expect(existsSync(join(repoRoot, ".windsurf", "hooks.json"))).toBe(false);
  });

  it("adds pre_user_prompt hook and merges mcp config", () => {
    mkdirSync(join(repoRoot, ".windsurf"), { recursive: true });
    writeJson(join(repoRoot, ".windsurf", "mcp.json"), { mcpServers: {} });

    setupWindsurfHooks(repoRoot, fakeDist);

    const hooks = JSON.parse(readFileSync(join(repoRoot, ".windsurf", "hooks.json"), "utf-8"));
    expect(hooks.hooks.pre_user_prompt).toHaveLength(1);
    expect(hooks.hooks.pre_user_prompt[0].command).toContain("windsurf");

    const mcp = JSON.parse(readFileSync(join(repoRoot, ".windsurf", "mcp.json"), "utf-8"));
    expect(mcp.mcpServers.traceback).toBeDefined();
  });
});

describe("warmStartScriptPath", () => {
  it("points at cli/warm-start.js under dist", () => {
    expect(warmStartScriptPath("C:/pkg/dist")).toBe("C:/pkg/dist/cli/warm-start.js");
  });
});
