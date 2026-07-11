import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  setupCursorHooks,
  installTracebackSkills,
  installGlobalCursorRule,
  renderTracebackCursorRule,
  setupVsCodeHooks,
  setupWindsurfHooks,
  TRACEBACK_RULE_MARKER,
  TRACEBACK_SERVER_ID_MARKER,
  warmStartScriptPath,
} from "../../src/cli/setup.js";

let repoRoot: string;
const fakeDist = "C:/fake/traceback/dist";

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "traceback-setup-hooks-"));
  process.env.TRACEBACK_DEV = "1";
});

afterEach(() => {
  delete process.env.TRACEBACK_DEV;
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
    expect(hooks.hooks.beforeReadFile[0].command).toContain("cursor-read");
    expect(hooks.hooks.preToolUse).toHaveLength(1);
    expect(hooks.hooks.preToolUse[0].matcher).toBe("Grep|Glob");
    expect(hooks.hooks.preToolUse[0].command).toContain("cursor-gate");
    expect(hooks.hooks.afterMCPExecution).toHaveLength(1);
    expect(hooks.hooks.afterMCPExecution[0].command).toContain("cursor-mcp-mark");

    const rule = readFileSync(join(repoRoot, ".cursor", "rules", "traceback.mdc"), "utf-8");
    expect(rule).toContain(TRACEBACK_RULE_MARKER);
    expect(rule).toContain(TRACEBACK_SERVER_ID_MARKER);
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain("search_with_fallback");
    expect(rule).toContain("get_connection_info");
    expect(rule).toContain("MANDATORY");
    expect(rule).toContain("preToolUse");
    expect(rule).toContain("user-traceback");
  });

  it("updates rule with call_server_id on second run", () => {
    mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
    writeJson(join(repoRoot, ".cursor", "mcp.json"), { mcpServers: {} });

    setupCursorHooks(repoRoot, fakeDist);
    const firstRule = readFileSync(join(repoRoot, ".cursor", "rules", "traceback.mdc"), "utf-8");
    setupCursorHooks(repoRoot, fakeDist);
    const secondRule = readFileSync(join(repoRoot, ".cursor", "rules", "traceback.mdc"), "utf-8");
    expect(secondRule).toContain(TRACEBACK_SERVER_ID_MARKER);
    expect(secondRule).toBe(firstRule);
  });

  it("does not duplicate gate hooks on second run", () => {
    mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
    writeJson(join(repoRoot, ".cursor", "mcp.json"), { mcpServers: {} });

    setupCursorHooks(repoRoot, fakeDist);
    setupCursorHooks(repoRoot, fakeDist);

    const hooks = JSON.parse(readFileSync(join(repoRoot, ".cursor", "hooks.json"), "utf-8"));
    expect(hooks.hooks.beforeReadFile).toHaveLength(1);
    expect(hooks.hooks.preToolUse).toHaveLength(1);
    expect(hooks.hooks.afterMCPExecution).toHaveLength(1);
  });

  it("is idempotent on second run for hooks", () => {
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

describe("installTracebackSkills", () => {
  it("installs skill into global host paths idempotently", () => {
    const cursorGlobalSkills = join(repoRoot, ".tmp-cursor-global-skills");
    const claudeSkills = join(repoRoot, ".tmp-claude-skills");
    const cursorProjectSkills = join(repoRoot, ".tmp-cursor-project-skills");
    process.env.TRACEBACK_CURSOR_SKILLS_DIR = cursorGlobalSkills;
    process.env.TRACEBACK_CLAUDE_SKILLS_DIR = claudeSkills;
    process.env.TRACEBACK_CURSOR_PROJECT_SKILLS_DIR = cursorProjectSkills;
    try {
      const skillSource = "<!-- traceback-skill -->\nname: traceback\n";
      writeFileSync(join(repoRoot, "SKILL.md"), skillSource, "utf-8");

      installTracebackSkills(repoRoot);
      const projectPath = join(cursorProjectSkills, "traceback", "SKILL.md");
      const globalPath = join(cursorGlobalSkills, "traceback", "SKILL.md");
      const claudePath = join(claudeSkills, "traceback", "SKILL.md");
      expect(existsSync(projectPath)).toBe(false);
      expect(existsSync(globalPath)).toBe(true);
      expect(existsSync(claudePath)).toBe(true);
      expect(readFileSync(globalPath, "utf-8")).toContain("name: traceback");

      const first = readFileSync(globalPath, "utf-8");
      installTracebackSkills(repoRoot);
      const second = readFileSync(globalPath, "utf-8");
      expect(second).toBe(first);
    } finally {
      delete process.env.TRACEBACK_CURSOR_PROJECT_SKILLS_DIR;
      delete process.env.TRACEBACK_CURSOR_SKILLS_DIR;
      delete process.env.TRACEBACK_CLAUDE_SKILLS_DIR;
    }
  });

  it("falls back to package SKILL.md when repo root has none", () => {
    const cursorGlobalSkills = join(repoRoot, ".tmp-cursor-global-skills-pkg");
    const fakePkgRoot = join(repoRoot, "fake-npm-pkg");
    const fakeDist = join(fakePkgRoot, "dist");
    process.env.TRACEBACK_CURSOR_SKILLS_DIR = cursorGlobalSkills;
    process.env.TRACEBACK_CLAUDE_SKILLS_DIR = join(repoRoot, ".tmp-unused-claude");
    try {
      mkdirSync(fakeDist, { recursive: true });
      writeFileSync(
        join(fakePkgRoot, "SKILL.md"),
        "<!-- traceback-skill -->\nname: traceback-from-package\n",
        "utf-8",
      );

      installTracebackSkills(repoRoot, fakeDist);
      const globalPath = join(cursorGlobalSkills, "traceback", "SKILL.md");
      expect(existsSync(globalPath)).toBe(true);
      expect(readFileSync(globalPath, "utf-8")).toContain("name: traceback-from-package");
    } finally {
      delete process.env.TRACEBACK_CURSOR_SKILLS_DIR;
      delete process.env.TRACEBACK_CLAUDE_SKILLS_DIR;
    }
  });
});

describe("installGlobalCursorRule", () => {
  it("writes alwaysApply rule with user-traceback by default", () => {
    const rulesDir = join(repoRoot, ".tmp-cursor-global-rules");
    process.env.TRACEBACK_CURSOR_RULES_DIR = rulesDir;
    try {
      installGlobalCursorRule();
      const rulePath = join(rulesDir, "traceback.mdc");
      expect(existsSync(rulePath)).toBe(true);
      const body = readFileSync(rulePath, "utf-8");
      expect(body).toBe(renderTracebackCursorRule("user-traceback"));
      expect(body).toContain("alwaysApply: true");
      expect(body).toContain("user-traceback");
      expect(body).toContain("GetMcpTools");
    } finally {
      delete process.env.TRACEBACK_CURSOR_RULES_DIR;
    }
  });
});
