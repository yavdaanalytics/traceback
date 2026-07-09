import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  TRACEBACK_EXCLUDE_MARKER,
  TRACEBACK_GLOBAL_EXCLUDE_MARKER,
  applyExcludeMode,
  ensureGlobalGitExcludes,
  ensureRepoInfoExclude,
  globalExcludesFilePath,
} from "../../src/cli/git-excludes.js";
import {
  resolveCommandMode,
  warmStartCommandPortable,
  mcpServerEntryPortable,
} from "../../src/cli/command-paths.js";
import { resolveRepoFromHookStdin, resolveRepoFromGit } from "../../src/cli/repo-resolve.js";
import {
  mergeGlobalCursorConfig,
  mergeGlobalClaudeConfig,
  setupGlobalCursorHooks,
} from "../../src/cli/setup.js";

describe("command-paths", () => {
  it("uses portable MCP entry by default for fake dist", () => {
    expect(resolveCommandMode("C:/fake/dist")).toBe("portable");
    expect(mcpServerEntryPortable()).toEqual({ command: "npx", args: ["-y", "traceback"] });
    expect(warmStartCommandPortable("cursor-read")).toContain("traceback-warmstart");
    expect(warmStartCommandPortable("cursor-read")).not.toContain("--repo-path");
  });

  it("uses dev mode when TRACEBACK_DEV is set", () => {
    process.env.TRACEBACK_DEV = "1";
    expect(resolveCommandMode("C:/fake/dist")).toBe("dev");
    delete process.env.TRACEBACK_DEV;
  });
});

describe("git-excludes", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "traceback-excludes-"));
    process.env.XDG_CONFIG_HOME = join(tmp, "xdg");
  });

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes global excludes idempotently", () => {
    const first = ensureGlobalGitExcludes();
    expect(first.changed).toBe(true);
    const content = readFileSync(first.path, "utf-8");
    expect(content).toContain(TRACEBACK_GLOBAL_EXCLUDE_MARKER);
    expect(content).toContain("/data/traceback.db");

    const second = ensureGlobalGitExcludes();
    expect(second.changed).toBe(false);
  });

  it("writes repo info/exclude when .git exists", () => {
    const repo = join(tmp, "repo");
    mkdirSync(join(repo, ".git", "info"), { recursive: true });
    const { changed, path } = ensureRepoInfoExclude(repo);
    expect(changed).toBe(true);
    expect(readFileSync(path, "utf-8")).toContain(TRACEBACK_EXCLUDE_MARKER);
  });

  it("applyExcludeMode global configures excludes file path", () => {
    const notes = applyExcludeMode("global");
    expect(notes.join(" ")).toMatch(/Global git excludes/);
    expect(existsSync(globalExcludesFilePath())).toBe(true);
  });
});

function normPath(p: string | null | undefined): string {
  if (!p) return "";
  try {
    return realpathSync.native(p).replace(/\\/g, "/").toLowerCase();
  } catch {
    return resolve(p).replace(/\\/g, "/").toLowerCase();
  }
}

describe("repo-resolve", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "traceback-repo-resolve-"));
    execFileSync("git", ["init"], { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("resolves from workspace_roots", () => {
    const resolved = resolveRepoFromHookStdin({ workspace_roots: [repo] }, "/tmp");
    expect(normPath(resolved)).toBe(normPath(repo));
  });

  it("resolves from git toplevel", () => {
    const resolved = resolveRepoFromGit(repo);
    expect(normPath(resolved)).toBe(normPath(repo));
  });
});

describe("global MCP bootstrap", () => {
  let tmpHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "traceback-global-setup-"));
    prevHome = process.env.USERPROFILE;
    process.env.USERPROFILE = tmpHome;
    process.env.HOME = tmpHome;
    process.env.TRACEBACK_INSTALL_REGISTRY_PATH = join(tmpHome, "install.json");
    process.env.TRACEBACK_DEV = "1";
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevHome;
    delete process.env.HOME;
    delete process.env.TRACEBACK_INSTALL_REGISTRY_PATH;
    delete process.env.TRACEBACK_DEV;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("creates global cursor and claude mcp configs", () => {
    mergeGlobalCursorConfig();
    mergeGlobalClaudeConfig();

    const cursor = JSON.parse(readFileSync(join(tmpHome, ".cursor", "mcp.json"), "utf-8"));
    const claude = JSON.parse(readFileSync(join(tmpHome, ".claude", ".mcp.json"), "utf-8"));
    expect(cursor.mcpServers.traceback).toBeDefined();
    expect(claude.mcpServers.traceback).toBeDefined();
  });

  it("creates global cursor hooks without repo path", () => {
    delete process.env.TRACEBACK_DEV;
    setupGlobalCursorHooks("C:/fake/dist");
    const hooks = JSON.parse(readFileSync(join(tmpHome, ".cursor", "hooks.json"), "utf-8"));
    expect(hooks.hooks.beforeReadFile[0].command).toContain("traceback-warmstart");
    expect(hooks.hooks.beforeReadFile[0].command).not.toContain("--repo-path");
  });
});
