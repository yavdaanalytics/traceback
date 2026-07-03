import { execFileSync } from "node:child_process";

// SECURITY: every function here must pass user-derived values as separate
// argv array elements to execFileSync, never interpolated into a shell
// string. A tool-call argument (pattern, sha, path) reaching a shell string
// is a command-injection vector (see PROMPT.md).

function runCapture(cmd: string, args: string[], cwd: string): string {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf-8" });
  } catch (error) {
    // Non-zero exit (e.g. no matches) is a normal outcome for grep-like tools.
    const err = error as { stdout?: string; status?: number };
    return err.stdout ?? "";
  }
}

// Structural pattern match via the ast-grep CLI (`sg`/`ast-grep`), scoped to
// the candidate files a prior semantic hit narrowed down to - catches
// renamed/reformatted matches plain-text grep misses.
export function astSearch(repoPath: string, pattern: string, files: string[], language?: string): string {
  const args = ["run", "--pattern", pattern, ...(language ? ["--lang", language] : []), ...files];
  return runCapture("ast-grep", args, repoPath);
}

// Exact/regex text search, scoped to specific files (the AST/semantic-narrowed
// candidate set) rather than the whole repo.
export function searchGrep(repoPath: string, pattern: string, files: string[]): string {
  const args = ["grep", "-n", "-e", pattern, "--", ...(files.length ? files : ["."])];
  return runCapture("git", args, repoPath);
}

// Resolves a match found in a historical commit to where it lives in HEAD
// today via `git log -L`, following renames - the code may have moved since
// the historical commit this session touched.
export function blameCurrent(
  repoPath: string,
  file: string,
  historicalCommit: string,
  lineOrSymbol: string,
): string {
  const isLineNumber = /^\d+$/.test(lineOrSymbol);
  const rangeArg = isLineNumber ? `${lineOrSymbol},${lineOrSymbol}` : `:${lineOrSymbol}`;
  const args = ["log", "--follow", "-L", `${rangeArg}:${file}`, `${historicalCommit}..HEAD`];
  const historyOutput = runCapture("git", args, repoPath);

  const blameArgs = isLineNumber
    ? ["blame", "--porcelain", "-L", `${lineOrSymbol},${lineOrSymbol}`, "HEAD", "--", file]
    : ["blame", "--porcelain", "HEAD", "--", file];
  const currentBlame = runCapture("git", blameArgs, repoPath);

  return `--- history since ${historicalCommit} ---\n${historyOutput}\n--- current blame ---\n${currentBlame}`;
}
