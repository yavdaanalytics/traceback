import { execFileSync } from "node:child_process";

// Returns the full commit-hash history of a branch, oldest-last (git log's
// natural order: newest first). Used so "N before / N after" a given anchor
// can be computed by array-index slicing, not by `~`/`^` revision-range syntax
// (`anchor~3..anchor^2` does not mean "3 before, 2 after" - `^2` selects a
// merge commit's *second parent*, not "2 commits forward in time"; git has no
// native forward walk on a single branch).
export function getCommitHistory(repoPath: string, branch = "HEAD"): string[] {
  const out = execFileSync("git", ["log", "--pretty=%H", branch], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  return out.split("\n").filter(Boolean);
}

export function getCommitWindow(
  repoPath: string,
  anchorSha: string,
  before: number,
  after: number,
  branch = "HEAD",
): string[] {
  const history = getCommitHistory(repoPath, branch); // newest first
  const idx = history.indexOf(anchorSha);
  if (idx === -1) return [anchorSha];
  // history[0] is newest, so "after" (more recent) is toward lower indices
  // and "before" (older) is toward higher indices.
  const start = Math.max(0, idx - after);
  const end = Math.min(history.length, idx + before + 1);
  return history.slice(start, end);
}

export function getHeadSha(repoPath: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoPath, encoding: "utf-8" }).trim();
}
