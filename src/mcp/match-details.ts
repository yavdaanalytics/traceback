import { readFileSync } from "node:fs";
import { normalize, resolve } from "node:path";
import { execFileSync } from "node:child_process";

function validateRepoPath(repoPath: string, filePath: string): string {
  const resolved = normalize(resolve(repoPath, filePath));
  const root = normalize(resolve(repoPath));
  if (!resolved.startsWith(root)) {
    throw new Error(`Path traversal rejected: ${filePath}`);
  }
  return resolved;
}

export function getMatchDetails(
  repoPath: string,
  file: string,
  lineStart: number,
  lineEnd: number,
  contextLines = 3,
): { file: string; line_start: number; line_end: number; snippet: string } {
  const resolved = validateRepoPath(repoPath, file);
  const raw = readFileSync(resolved, "utf-8");
  const lines = raw.split("\n");
  const start = Math.max(1, lineStart - contextLines);
  const end = Math.min(lines.length, lineEnd + contextLines);
  const snippet = lines.slice(start - 1, end).map((line, idx) => `${start + idx}:${line}`).join("\n");
  return { file, line_start: lineStart, line_end: lineEnd, snippet };
}

export function getCommitFiles(repoPath: string, commitSha: string): string[] {
  try {
    const out = execFileSync("git", ["show", "--name-only", "--format=", commitSha], {
      cwd: repoPath,
      encoding: "utf-8",
    });
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

