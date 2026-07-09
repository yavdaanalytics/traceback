import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { HookStdin } from "./warm-start-format.js";

export function resolveRepoFromGit(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function resolveRepoFromHookStdin(stdin: HookStdin | null, fallbackCwd: string): string | null {
  const roots = stdin?.workspace_roots;
  if (Array.isArray(roots) && roots.length > 0) {
    for (const root of roots) {
      const abs = resolve(root);
      const fromGit = resolveRepoFromGit(abs);
      if (fromGit) return fromGit;
      if (existsSync(join(abs, ".git"))) return abs;
    }
  }

  const cursorDir = process.env.CURSOR_PROJECT_DIR?.trim();
  if (cursorDir) {
    const fromGit = resolveRepoFromGit(cursorDir);
    if (fromGit) return fromGit;
  }

  const claudeDir = process.env.CLAUDE_PROJECT_DIR?.trim();
  if (claudeDir) {
    const fromGit = resolveRepoFromGit(claudeDir);
    if (fromGit) return fromGit;
  }

  const cwd = stdin?.cwd?.trim() || fallbackCwd;
  return resolveRepoFromGit(cwd);
}
