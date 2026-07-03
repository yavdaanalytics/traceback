import { execFileSync } from "node:child_process";
import { addFileTouched, linkSessionCommit, upsertCommit } from "../storage/sqlite.js";
import { detectAndRecordReverts } from "./revert-detection.js";

function recordFilesTouched(sqlitePath: string, repoPath: string, sha: string): void {
  // `-m` so merge commits are diffed against each parent rather than
  // producing no output (the default). First commits (no parent) still work:
  // git diff-tree falls back to comparing against the empty tree.
  const output = execFileSync(
    "git",
    ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", sha],
    { cwd: repoPath, encoding: "utf-8" },
  ).trim();
  if (!output) return;
  for (const line of output.split("\n")) {
    const [changeType, filePath] = line.split("\t");
    if (!filePath) continue;
    addFileTouched(sqlitePath, { sha, file_path: filePath, change_type: changeType });
  }
}

export function recordCommit(sqlitePath: string, repoPath: string, sha: string): void {
  const output = execFileSync("git", ["show", "-s", "--format=%H%x1f%aI%x1f%s%x1f%P", sha], {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
  const [fullSha, authorDate, message, parents] = output.split("\x1f");
  upsertCommit(sqlitePath, {
    sha: fullSha,
    repo_path: repoPath,
    author_date: Date.parse(authorDate),
    message,
    parent_sha: parents ? parents.trim().split(" ")[0] || null : null,
  });
  recordFilesTouched(sqlitePath, repoPath, fullSha);
  detectAndRecordReverts(sqlitePath, repoPath, fullSha);
}

export function linkSessionToCommit(
  sqlitePath: string,
  repoPath: string,
  sessionId: string,
  sha: string,
  source: "hook" | "manual",
  confidence: number,
): void {
  recordCommit(sqlitePath, repoPath, sha);
  linkSessionCommit(sqlitePath, {
    session_id: sessionId,
    sha,
    link_source: source,
    linked_at: Date.now(),
    confidence,
  });
}
