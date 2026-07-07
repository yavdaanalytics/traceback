import { execFileSync } from "node:child_process";
import { getCommitWindow } from "../git/commit-window.js";
import {
  getCommit,
  getFilesForCommit,
  getLinksForCommit,
  getLinksForSession,
  getOutcome,
  getRelatedCommits,
  getSession,
} from "../storage/sqlite.js";

export interface ChangeGraphEdge {
  type: "fixed_by" | "superseded_by" | "follow_up" | "reverts" | "reverted_by";
  target_sha: string;
}

export interface TimelineEntry {
  sha: string;
  author_date: number | null;
  message: string | null;
  outcome: string | null;
  connection: "direct" | "nearby";
  edges: ChangeGraphEdge[];
  linked_session_ids: string[];
  files_touched: string[];
}

const RELATION_MAP: Record<string, ChangeGraphEdge["type"]> = {
  fixes: "fixed_by",
  supersedes: "superseded_by",
  follows: "follow_up",
  reverts: "reverts",
  reverted_by: "reverted_by",
};

export interface ChangeGraphResult {
  queried: { session_id?: string; commit_sha?: string };
  context_window: string[];
  timeline: TimelineEntry[];
}

export function getChangeGraph(
  sqlitePath: string,
  repoPath: string,
  anchor: { sessionId?: string; commitSha?: string },
  opts: { before?: number; after?: number; windowMs?: number } = {},
): ChangeGraphResult {
  const before = opts.before ?? 3;
  const after = opts.after ?? 3;
  const windowMs = opts.windowMs ?? 30 * 60 * 1000;

  const startCommits = new Set<string>();
  if (anchor.commitSha) startCommits.add(anchor.commitSha);
  if (anchor.sessionId) {
    for (const link of getLinksForSession(sqlitePath, anchor.sessionId)) {
      startCommits.add(link.sha);
    }
  }

  const queried = {
    session_id: anchor.sessionId,
    commit_sha: anchor.commitSha ?? [...startCommits][0],
  };

  let contextWindow: string[] = [];
  const primarySha = anchor.commitSha ?? [...startCommits][0];
  if (primarySha) {
    contextWindow = getCommitWindow(repoPath, primarySha, before, after);
  }

  const timeline: TimelineEntry[] = [];
  const seen = new Set<string>();

  for (const sha of startCommits) {
    seen.add(sha);
    timeline.push(buildEntry(sqlitePath, sha, "direct"));
    for (const rel of getRelatedCommits(sqlitePath, sha)) {
      if (seen.has(rel.sha)) continue;
      seen.add(rel.sha);
      const entry = buildEntry(sqlitePath, rel.sha, "direct");
      const mapped = RELATION_MAP[rel.relation];
      if (mapped) {
        entry.edges.push({ type: mapped, target_sha: sha });
      }
      timeline.push(entry);
    }
  }

  if (primarySha) {
    const anchorCommit = getCommit(sqlitePath, primarySha);
    const anchorTime = anchorCommit?.author_date ?? 0;
    const anchorFiles = new Set(getFilesForCommit(sqlitePath, primarySha));

    for (const sha of contextWindow) {
      if (seen.has(sha)) continue;
      const commit = getCommit(sqlitePath, sha);
      if (!commit) continue;
      const timeDelta = Math.abs((commit.author_date ?? 0) - anchorTime);
      const files = getFilesForCommit(sqlitePath, sha);
      const overlap = files.some((f) => anchorFiles.has(f));
      if (timeDelta <= windowMs && overlap) {
        seen.add(sha);
        timeline.push(buildEntry(sqlitePath, sha, "nearby"));
      }
    }
  }

  timeline.sort((a, b) => (a.author_date ?? 0) - (b.author_date ?? 0));

  return { queried, context_window: contextWindow, timeline };
}

function buildEntry(sqlitePath: string, sha: string, connection: "direct" | "nearby"): TimelineEntry {
  const commit = getCommit(sqlitePath, sha);
  const outcome = getOutcome(sqlitePath, sha);
  return {
    sha,
    author_date: commit?.author_date ?? null,
    message: commit?.message ?? null,
    outcome: outcome?.outcome ?? null,
    connection,
    edges: [],
    linked_session_ids: getLinksForCommit(sqlitePath, sha).map((l) => l.session_id),
    files_touched: getFilesForCommit(sqlitePath, sha),
  };
}

export function getSessionLineageFromGraph(
  sqlitePath: string,
  repoPath: string,
  anchor: { sessionId?: string; commitSha?: string },
  direction: "forward" | "backward" | "both" = "both",
  hops = 2,
): TimelineEntry[] {
  const graph = getChangeGraph(sqlitePath, repoPath, anchor, { before: hops, after: hops });
  const anchorDate = graph.timeline.find((t) => t.connection === "direct")?.author_date ?? 0;
  return graph.timeline.filter((t) => {
    if (direction === "both") return true;
    if (t.author_date == null) return true;
    if (direction === "backward") return t.author_date <= anchorDate;
    return t.author_date >= anchorDate;
  });
}
