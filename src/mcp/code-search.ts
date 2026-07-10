import { execFileSync } from "node:child_process";
import { resolve, normalize } from "node:path";

function runCapture(cmd: string, args: string[], cwd: string): string {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf-8" });
  } catch (error) {
    const err = error as { stdout?: string };
    return err.stdout ?? "";
  }
}

function validateRepoPath(repoPath: string, filePath: string): string {
  const resolved = normalize(resolve(repoPath, filePath));
  const root = normalize(resolve(repoPath));
  if (!resolved.startsWith(root)) {
    throw new Error(`Path traversal rejected: ${filePath}`);
  }
  return filePath;
}

export function diffSearch(
  repoPath: string,
  pattern: string,
  opts: { files?: string[]; commit_range?: string } = {},
): string {
  const args = ["log", "-p", "-S", pattern, "--"];
  if (opts.commit_range) {
    // Reject option-like revisions so values such as `--output=…` cannot be
    // interpreted as git flags (execFile argv isolation alone is not enough).
    if (opts.commit_range.startsWith("-")) {
      return "";
    }
    args.splice(1, 0, opts.commit_range);
  }
  if (opts.files?.length) {
    for (const f of opts.files) args.push(validateRepoPath(repoPath, f));
  } else {
    args.push(".");
  }
  return runCapture("git", args, repoPath);
}

const KEYWORD_PATTERN = String.raw`\b(TODO|FIXME|BUG|XXX|HACK|NOTE)\b`;

export function keywordSearch(
  repoPath: string,
  keyword?: string,
  opts: { path?: string; files?: string[] } = {},
): string {
  const pattern = keyword ? String.raw`\b${keyword}\b` : KEYWORD_PATTERN;
  const searchPath = opts.path ?? ".";
  const args = ["grep", "-E", "-n", "-e", pattern, "--"];
  if (opts.files?.length) {
    for (const f of opts.files) args.push(validateRepoPath(repoPath, f));
  } else {
    args.push(searchPath);
  }
  return runCapture("git", args, repoPath);
}
