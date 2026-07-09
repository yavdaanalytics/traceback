import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const TRACEBACK_EXCLUDE_MARKER = "# traceback-local-artifacts";
export const TRACEBACK_GLOBAL_EXCLUDE_MARKER = "# traceback-global-artifacts";

export const TRACEBACK_EXCLUDE_PATTERNS = [
  "/data/traceback.db",
  "/data/lancedb/",
  "/.traceback/",
] as const;

export type ExcludeMode = "global" | "local" | "gitignore";

export function globalExcludesFilePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg ? join(xdg, "git") : join(homedir(), ".config", "git");
  return join(base, "ignore");
}

export function ensureGlobalGitExcludes(): { path: string; changed: boolean } {
  const path = globalExcludesFilePath();
  mkdirSync(join(path, ".."), { recursive: true });
  const block = [
    TRACEBACK_GLOBAL_EXCLUDE_MARKER,
    ...TRACEBACK_EXCLUDE_PATTERNS,
    "",
  ].join("\n");

  let content = "";
  if (existsSync(path)) content = readFileSync(path, "utf-8");
  if (content.includes(TRACEBACK_GLOBAL_EXCLUDE_MARKER)) {
    return { path, changed: false };
  }
  const next = content.length > 0 && !content.endsWith("\n") ? `${content}\n\n${block}` : `${content}${block}`;
  writeFileSync(path, next, "utf-8");
  return { path, changed: true };
}

export function ensureGitCoreExcludesFile(): { path: string; changed: boolean } {
  const excludesPath = globalExcludesFilePath();
  ensureGlobalGitExcludes();
  let changed = false;
  try {
    const current = execFileSync("git", ["config", "--global", "core.excludesFile"], {
      encoding: "utf-8",
    }).trim();
    if (current !== excludesPath) {
      execFileSync("git", ["config", "--global", "core.excludesFile", excludesPath], {
        encoding: "utf-8",
      });
      changed = true;
    }
  } catch {
    execFileSync("git", ["config", "--global", "core.excludesFile", excludesPath], {
      encoding: "utf-8",
    });
    changed = true;
  }
  return { path: excludesPath, changed };
}

export function ensureRepoInfoExclude(repoRoot: string): { path: string; changed: boolean } {
  const excludePath = join(repoRoot, ".git", "info", "exclude");
  if (!existsSync(join(repoRoot, ".git"))) {
    return { path: excludePath, changed: false };
  }
  mkdirSync(join(repoRoot, ".git", "info"), { recursive: true });
  const block = [
    TRACEBACK_EXCLUDE_MARKER,
    ...TRACEBACK_EXCLUDE_PATTERNS,
    "",
  ].join("\n");

  let content = "";
  if (existsSync(excludePath)) content = readFileSync(excludePath, "utf-8");
  if (content.includes(TRACEBACK_EXCLUDE_MARKER)) {
    return { path: excludePath, changed: false };
  }
  const next = content.length > 0 && !content.endsWith("\n") ? `${content}\n\n${block}` : `${content}${block}`;
  writeFileSync(excludePath, next, "utf-8");
  return { path: excludePath, changed: true };
}

export function ensureRepoGitignore(repoRoot: string): { path: string; changed: boolean } {
  const gitignorePath = join(repoRoot, ".gitignore");
  const block = [
    TRACEBACK_EXCLUDE_MARKER,
    ...TRACEBACK_EXCLUDE_PATTERNS,
    "",
  ].join("\n");

  let content = "";
  if (existsSync(gitignorePath)) content = readFileSync(gitignorePath, "utf-8");
  if (content.includes(TRACEBACK_EXCLUDE_MARKER)) {
    return { path: gitignorePath, changed: false };
  }
  const next = content.length > 0 && !content.endsWith("\n") ? `${content}\n\n${block}` : `${content}${block}`;
  writeFileSync(gitignorePath, next, "utf-8");
  return { path: gitignorePath, changed: true };
}

export function applyExcludeMode(mode: ExcludeMode, repoRoot?: string): string[] {
  const notes: string[] = [];
  if (mode === "global") {
    const { path, changed } = ensureGitCoreExcludesFile();
    notes.push(
      changed
        ? `Global git excludes: ${path} (core.excludesFile set)`
        : `Global git excludes already configured: ${path}`,
    );
  } else if (mode === "local" && repoRoot) {
    const { path, changed } = ensureRepoInfoExclude(repoRoot);
    if (changed) notes.push(`Repo info/exclude updated: ${path}`);
    else notes.push(`Repo info/exclude already present: ${path}`);
  } else if (mode === "gitignore" && repoRoot) {
    const { path, changed } = ensureRepoGitignore(repoRoot);
    if (changed) notes.push(`.gitignore updated: ${path}`);
    else notes.push(`.gitignore already contains traceback patterns: ${path}`);
  }
  return notes;
}
