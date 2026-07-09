import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { TRACEBACK_CONFIG_KEY } from "../install/registry.js";
import { globalExcludesFilePath, TRACEBACK_GLOBAL_EXCLUDE_MARKER } from "./git-excludes.js";
import { hasClaudeMdOnboarding, TRACEBACK_CLAUDE_MD_MARKER_START } from "./claude-md-onboarding.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTracebackMcpEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  if (e.command === "npx" && Array.isArray(e.args) && (e.args as string[]).includes("traceback")) {
    return true;
  }
  if (e.command === "traceback") return true;
  if (e.command === "node" && Array.isArray(e.args)) {
    return (e.args as string[]).some((a) => typeof a === "string" && a.includes("mcp") && a.includes("index.js"));
  }
  return false;
}

function checkMcpEntry(path: string, label: string, serversKey: "mcpServers" | "servers"): DoctorCheck {
  const parsed = readJson(path);
  if (!parsed) {
    return { name: label, ok: false, detail: `missing or invalid: ${path}` };
  }
  const servers = (parsed[serversKey] as Record<string, unknown> | undefined) ?? {};
  const existing = servers[TRACEBACK_CONFIG_KEY];
  if (!existing) {
    return { name: label, ok: false, detail: `no "${TRACEBACK_CONFIG_KEY}" entry in ${path}` };
  }
  const ok = isTracebackMcpEntry(existing);
  return {
    name: label,
    ok,
    detail: ok ? `configured at ${path}` : `unexpected command shape at ${path}`,
  };
}

export function runSetupDoctor(repoRoot?: string): DoctorReport {
  const checks: DoctorCheck[] = [];
  const home = homedir();

  checks.push(checkMcpEntry(join(home, ".cursor", "mcp.json"), "Cursor global MCP", "mcpServers"));
  checks.push(checkMcpEntry(join(home, ".claude", ".mcp.json"), "Claude global MCP", "mcpServers"));

  const cursorHooks = join(home, ".cursor", "hooks.json");
  if (!existsSync(cursorHooks)) {
    checks.push({ name: "Cursor global hooks", ok: false, detail: `missing ${cursorHooks}` });
  } else {
    const parsed = readJson(cursorHooks);
    const hooks = (parsed?.hooks as Record<string, unknown> | undefined) ?? {};
    const beforeRead = (hooks.beforeReadFile as unknown[] | undefined) ?? [];
    const hasWarm = beforeRead.some((e) => {
      const cmd = (e as Record<string, unknown>).command;
      return typeof cmd === "string" && (cmd.includes("warm-start") || cmd.includes("traceback-warmstart"));
    });
    checks.push({
      name: "Cursor global hooks",
      ok: hasWarm,
      detail: hasWarm ? `warm-start hook present in ${cursorHooks}` : `no warm-start hook in ${cursorHooks}`,
    });
  }

  const claudeSettings = join(home, ".claude", "settings.json");
  if (!existsSync(claudeSettings)) {
    checks.push({ name: "Claude hooks", ok: false, detail: `missing ${claudeSettings}` });
  } else {
    const parsed = readJson(claudeSettings);
    const hooks = parsed?.hooks;
    checks.push({
      name: "Claude hooks",
      ok: hooks !== undefined,
      detail: hooks !== undefined ? `hooks configured in ${claudeSettings}` : `no hooks key in ${claudeSettings}`,
    });
  }

  const globalHooksDir = join(home, ".traceback", "hooks").replace(/\\/g, "/");
  let hooksPath = "";
  try {
    hooksPath = execFileSync("git", ["config", "--global", "core.hooksPath"], { encoding: "utf-8" }).trim();
  } catch {
    hooksPath = "";
  }
  const postCommit = join(home, ".traceback", "hooks", "post-commit");
  checks.push({
    name: "Global git hooks",
    ok: hooksPath.replace(/\\/g, "/") === globalHooksDir && existsSync(postCommit),
    detail: hooksPath
      ? `core.hooksPath=${hooksPath}${existsSync(postCommit) ? "" : " (post-commit missing)"}`
      : "core.hooksPath not set to ~/.traceback/hooks",
  });

  const excludesPath = globalExcludesFilePath();
  const excludesOk =
    existsSync(excludesPath) && readFileSync(excludesPath, "utf-8").includes(TRACEBACK_GLOBAL_EXCLUDE_MARKER);
  checks.push({
    name: "Global git excludes",
    ok: excludesOk,
    detail: excludesOk ? `patterns in ${excludesPath}` : `missing traceback block in ${excludesPath}`,
  });

  const skillPath = join(home, ".cursor", "skills", "traceback", "SKILL.md");
  checks.push({
    name: "Cursor global skill",
    ok: existsSync(skillPath),
    detail: existsSync(skillPath) ? skillPath : `missing ${skillPath}`,
  });

  if (repoRoot) {
    const claudeMdPath = join(repoRoot, "CLAUDE.md");
    const hasOnboarding = hasClaudeMdOnboarding(repoRoot);
    checks.push({
      name: "CLAUDE.md onboarding",
      ok: hasOnboarding,
      detail: hasOnboarding
        ? `marker present in ${claudeMdPath}`
        : existsSync(claudeMdPath)
          ? `missing ${TRACEBACK_CLAUDE_MD_MARKER_START} in ${claudeMdPath}`
          : `missing ${claudeMdPath} — run traceback-setup --repo-only`,
    });
  }

  const ok = checks.every((c) => c.ok);
  return { checks, ok };
}

export function printDoctorReport(report: DoctorReport): void {
  console.log("\n🩺 Traceback setup doctor\n");
  for (const check of report.checks) {
    const icon = check.ok ? "✅" : "❌";
    console.log(`${icon} ${check.name}: ${check.detail}`);
  }
  console.log(report.ok ? "\nAll checks passed." : "\nSome checks failed — re-run `traceback-setup` or fix manually.");
}
