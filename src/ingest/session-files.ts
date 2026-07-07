import { execFileSync } from "node:child_process";
import type { ParsedSession, Turn } from "../adapters/types.js";

const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/gi;

const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

/** Union of file paths touched by Edit / Write / NotebookEdit tool calls. */
export function extractEditFiles(turns: Turn[]): string[] {
  const files = new Set<string>();
  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      if (!FILE_EDIT_TOOLS.has(tc.toolName)) continue;
      if (tc.filePath) files.add(tc.filePath);
      else if (typeof tc.input === "object" && tc.input && "file_path" in tc.input) {
        const fp = (tc.input as Record<string, unknown>).file_path;
        if (typeof fp === "string" && fp) files.add(fp);
      }
    }
  }
  return [...files];
}

/** Scan Bash commands for hex SHAs near git usage (candidates only — validate before linking). */
export function extractCommitHashCandidates(turns: Turn[]): string[] {
  const candidates = new Set<string>();
  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      if (!tc.isShellCommand || !tc.command) continue;
      if (!/\bgit\b/i.test(tc.command)) continue;
      for (const match of tc.command.matchAll(SHA_PATTERN)) {
        candidates.add(match[0].toLowerCase());
      }
    }
  }
  return [...candidates];
}

export function validateCommitHash(repoPath: string, sha: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", sha], { cwd: repoPath, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function resolveFullCommitSha(repoPath: string, sha: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", sha], { cwd: repoPath, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export interface SessionLinkageMetadata {
  editFiles: string[];
  commitHashes: string[];
  todos?: unknown[];
  history?: unknown[];
}

export function buildSessionLinkageMetadata(
  session: ParsedSession,
  existing?: { todos?: unknown[]; history?: unknown[] },
  repoPath?: string,
): SessionLinkageMetadata {
  const editFiles = extractEditFiles(session.turns);
  const rawHashes = extractCommitHashCandidates(session.turns);
  const commitHashes: string[] = [];
  if (repoPath) {
    for (const candidate of rawHashes) {
      if (!validateCommitHash(repoPath, candidate)) continue;
      const full = resolveFullCommitSha(repoPath, candidate);
      if (full) commitHashes.push(full);
    }
  }
  return {
    editFiles,
    commitHashes: [...new Set(commitHashes)],
    ...(existing?.todos?.length ? { todos: existing.todos } : {}),
    ...(existing?.history?.length ? { history: existing.history } : {}),
  };
}

export function metadataNeedsLinkageEnrichment(metadataJson: string | null | undefined): boolean {
  if (!metadataJson) return true;
  try {
    const meta = JSON.parse(metadataJson) as { editFiles?: unknown };
    return meta.editFiles === undefined;
  } catch {
    return true;
  }
}
