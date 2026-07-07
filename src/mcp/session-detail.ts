import { readFileSync, existsSync } from "node:fs";
import { resolve, normalize } from "node:path";
import {
  getSession,
  getSessionAttempts,
  getLinksForSession,
  getCommit,
  getFilesForCommit,
  getOutcome,
} from "../storage/sqlite.js";

function validateTranscriptPath(transcriptRef: string, repoPath: string): string {
  const resolved = resolve(transcriptRef);
  const repoRoot = resolve(repoPath);
  const normalizedResolved = normalize(resolved);
  const normalizedRepo = normalize(repoRoot);
  if (!normalizedResolved.startsWith(normalizedRepo)) {
    throw new Error(`transcript_ref outside allowed paths: ${transcriptRef}`);
  }
  return resolved;
}

export interface SessionDetailResult {
  session: ReturnType<typeof getSession>;
  embedding_text: string | null;
  transcript_ref: string | null;
  attempts: ReturnType<typeof getSessionAttempts>;
  linked_commits: Array<{
    sha: string;
    message: string | null;
    outcome: string | null;
    files: string[];
  }>;
  raw_transcript?: string;
}

export function getSessionDetail(
  sqlitePath: string,
  sessionId: string,
  opts: { includeRaw?: boolean; repoPath?: string } = {},
): SessionDetailResult {
  const session = getSession(sqlitePath, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const result: SessionDetailResult = {
    session,
    embedding_text: session.embedding_text ?? null,
    transcript_ref: session.transcript_ref ?? session.raw_path ?? null,
    attempts: getSessionAttempts(sqlitePath, sessionId),
    linked_commits: getLinksForSession(sqlitePath, sessionId).map((link) => {
      const commit = getCommit(sqlitePath, link.sha);
      const outcome = getOutcome(sqlitePath, link.sha);
      return {
        sha: link.sha,
        message: commit?.message ?? null,
        outcome: outcome?.outcome ?? null,
        files: getFilesForCommit(sqlitePath, link.sha),
      };
    }),
  };

  if (opts.includeRaw && result.transcript_ref) {
    const path = opts.repoPath
      ? validateTranscriptPath(result.transcript_ref, opts.repoPath)
      : result.transcript_ref;
    if (existsSync(path)) {
      result.raw_transcript = readFileSync(path, "utf-8");
    }
  }

  return result;
}
