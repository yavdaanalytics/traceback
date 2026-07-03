import { execFileSync } from "node:child_process";
import { addRelation, setOutcome } from "../storage/sqlite.js";

const REVERT_TRAILER = /This reverts commit ([0-9a-f]{7,40})/i;

// Heuristic, low-confidence by design (see PROMPT.md / commit_outcomes):
// detects `git revert`'s standard trailer in a commit message and links the
// two commits. Does not attempt build-status detection (no CI signal
// available locally) - "broke_build" stays a manually-tagged outcome via
// tag_outcome in v1.
export function detectAndRecordReverts(sqlitePath: string, repoPath: string, sha: string): void {
  const message = execFileSync("git", ["log", "-1", "--pretty=%B", sha], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  const match = message.match(REVERT_TRAILER);
  if (!match) return;
  const revertedSha = match[1];

  addRelation(sqlitePath, { sha, related_sha: revertedSha, relation: "reverts" });
  addRelation(sqlitePath, { sha: revertedSha, related_sha: sha, relation: "reverted_by" });
  setOutcome(sqlitePath, {
    sha: revertedSha,
    outcome: "reverted",
    derived_at: Date.now(),
    evidence: `reverted by ${sha}`,
  });
}
