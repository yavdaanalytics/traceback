import { execFileSync } from "node:child_process";
import { DEFAULT_COMMIT_WINDOW_MS } from "../config.js";
import {
  getCommit,
  getFilesForCommit,
  getLinksForSession,
  getOutcome,
  getSession,
  linkSessionCommit,
  upsertSessionAttempt,
} from "../storage/sqlite.js";
import { recordCommit } from "./linkage.js";

function getCommitFiles(repoPath: string, sha: string): string[] {
  try {
    const out = execFileSync("git", ["show", "--name-only", "--format=", sha], {
      cwd: repoPath,
      encoding: "utf-8",
    });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function getSessionEditFiles(sessionId: string, sqlitePath: string): string[] {
  const session = getSession(sqlitePath, sessionId);
  if (!session?.metadata_json) return [];
  try {
    const meta = JSON.parse(session.metadata_json) as { editFiles?: string[] };
    return meta.editFiles ?? [];
  } catch {
    return [];
  }
}

function collectSessionFilePaths(sqlitePath: string, sessionId: string): Set<string> {
  const files = new Set<string>();
  for (const link of getLinksForSession(sqlitePath, sessionId)) {
    for (const f of getFilesForCommit(sqlitePath, link.sha)) files.add(f);
  }
  return files;
}

export function correlateCommitToSession(
  sqlitePath: string,
  repoPath: string,
  sessionId: string,
  commitSha: string,
  windowMs: number = DEFAULT_COMMIT_WINDOW_MS,
): number {
  const session = getSession(sqlitePath, sessionId);
  const commit = getCommit(sqlitePath, commitSha);
  if (!session || !commit) return 0;

  recordCommit(sqlitePath, repoPath, commitSha);
  const sessionEnd = session.ended_at ?? 0;
  const commitTime = commit.author_date ?? 0;
  const timeDelta = Math.abs(commitTime - sessionEnd);
  if (timeDelta > windowMs) return 0;

  const commitFiles = new Set(getCommitFiles(repoPath, commitSha));
  const sessionFiles = collectSessionFilePaths(sqlitePath, sessionId);
  for (const f of getSessionEditFiles(sessionId, sqlitePath)) sessionFiles.add(f);

  let overlap = 0;
  for (const f of commitFiles) {
    if (sessionFiles.has(f)) overlap++;
  }
  if (overlap === 0 && sessionFiles.size > 0 && commitFiles.size > 0) return 0;

  const confidence = overlap > 0 ? Math.min(0.9, 0.5 + overlap * 0.1) : 0.4;
  linkSessionCommit(sqlitePath, {
    session_id: sessionId,
    sha: commitSha,
    link_source: "hook",
    linked_at: Date.now(),
    confidence,
  });
  return confidence;
}

export function deriveSessionAttempts(sqlitePath: string, repoPath: string, sessionId: string): void {
  const links = getLinksForSession(sqlitePath, sessionId)
    .map((l) => ({ ...l, commit: getCommit(sqlitePath, l.sha) }))
    .filter((l) => l.commit?.author_date != null)
    .sort((a, b) => (a.commit!.author_date ?? 0) - (b.commit!.author_date ?? 0));

  links.forEach((link, attemptIndex) => {
    const outcome = getOutcome(sqlitePath, link.sha)?.outcome ?? "unknown";
    upsertSessionAttempt(sqlitePath, {
      session_id: sessionId,
      attempt_index: attemptIndex,
      commit_sha: link.sha,
      outcome,
      linked_at: Date.now(),
    });
  });

  for (const link of links) {
    correlateCommitToSession(sqlitePath, repoPath, sessionId, link.sha);
  }
}
