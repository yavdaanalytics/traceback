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
import { linkSessionToCommit, recordCommit } from "./linkage.js";

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

export function linkValidatedTranscriptCommits(
  sqlitePath: string,
  repoPath: string,
  sessionId: string,
  commitHashes: string[],
): void {
  for (const sha of commitHashes) {
    linkSessionToCommit(sqlitePath, repoPath, sessionId, sha, "manual", 0.95);
  }
}

export function correlateCommitToSession(
  sqlitePath: string,
  repoPath: string,
  sessionId: string,
  commitSha: string,
  windowMs: number = DEFAULT_COMMIT_WINDOW_MS,
  linkSource: "hook" | "manual" = "hook",
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
    link_source: linkSource,
    linked_at: Date.now(),
    confidence,
  });
  return confidence;
}

/** Walk git log around session end time; link by file overlap or sole candidate in window. */
export function correlateSessionByTimestamp(
  sqlitePath: string,
  repoPath: string,
  sessionId: string,
  windowMs: number = DEFAULT_COMMIT_WINDOW_MS,
): void {
  const session = getSession(sqlitePath, sessionId);
  if (!session?.ended_at) return;

  const sessionEnd = session.ended_at;
  const since = new Date(sessionEnd - windowMs).toISOString();
  const until = new Date(sessionEnd + windowMs).toISOString();

  let candidates: string[];
  try {
    const out = execFileSync(
      "git",
      ["log", "--format=%H", "--since", since, "--until", until],
      { cwd: repoPath, encoding: "utf-8" },
    ).trim();
    candidates = out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return;
  }
  if (candidates.length === 0) return;

  const sessionFiles = new Set(getSessionEditFiles(sessionId, sqlitePath));
  const existingShas = new Set(getLinksForSession(sqlitePath, sessionId).map((l) => l.sha));

  for (const sha of candidates) {
    if (existingShas.has(sha)) continue;

    recordCommit(sqlitePath, repoPath, sha);
    const commitFiles = getCommitFiles(repoPath, sha);
    let overlap = 0;
    for (const f of commitFiles) {
      if (sessionFiles.has(f)) overlap++;
    }

    const soleCandidate = candidates.length === 1;
    if (overlap === 0 && !soleCandidate) continue;
    if (overlap === 0 && sessionFiles.size > 0 && commitFiles.length > 0) continue;

    const confidence = overlap > 0 ? Math.min(0.85, 0.45 + overlap * 0.1) : 0.4;
    linkSessionCommit(sqlitePath, {
      session_id: sessionId,
      sha,
      link_source: "manual",
      linked_at: Date.now(),
      confidence,
    });
    existingShas.add(sha);
  }
}

export function deriveSessionAttempts(sqlitePath: string, repoPath: string, sessionId: string): void {
  let links = getLinksForSession(sqlitePath, sessionId);
  if (links.length === 0) {
    correlateSessionByTimestamp(sqlitePath, repoPath, sessionId);
    links = getLinksForSession(sqlitePath, sessionId);
  }

  const sortedLinks = links
    .map((l) => ({ ...l, commit: getCommit(sqlitePath, l.sha) }))
    .filter((l) => l.commit?.author_date != null)
    .sort((a, b) => (a.commit!.author_date ?? 0) - (b.commit!.author_date ?? 0));

  sortedLinks.forEach((link, attemptIndex) => {
    const outcome = getOutcome(sqlitePath, link.sha)?.outcome ?? "unknown";
    upsertSessionAttempt(sqlitePath, {
      session_id: sessionId,
      attempt_index: attemptIndex,
      commit_sha: link.sha,
      outcome,
      linked_at: Date.now(),
    });
  });

  for (const link of sortedLinks) {
    correlateCommitToSession(
      sqlitePath,
      repoPath,
      sessionId,
      link.sha,
      DEFAULT_COMMIT_WINDOW_MS,
      link.link_source === "manual" ? "manual" : "hook",
    );
  }
}
