import {
  getCommit,
  getFilesForCommit,
  getLinksForCommit,
  getLinksForSession,
  getOutcome,
  getRelatedCommits,
  getSession,
} from "../storage/sqlite.js";

export interface LineageNode {
  sha: string;
  authorDate: number | null;
  message: string | null;
  outcome: string | null;
  relationToAnchor: string | null;
  linkedSessionIds: string[];
  filesTouched: string[];
  position: "before" | "after" | "self";
}

export function getSessionLineage(
  sqlitePath: string,
  anchor: { sessionId?: string; commitSha?: string },
  direction: "forward" | "backward" | "both" = "both",
  hops = 2,
): LineageNode[] {
  const startCommits = new Set<string>();
  if (anchor.commitSha) startCommits.add(anchor.commitSha);
  if (anchor.sessionId) {
    for (const link of getLinksForSession(sqlitePath, anchor.sessionId)) {
      startCommits.add(link.sha);
    }
  }
  if (startCommits.size === 0) return [];

  const anchorDate = Math.min(
    ...[...startCommits].map((sha) => getCommit(sqlitePath, sha)?.author_date ?? Infinity),
  );

  const visited = new Map<string, string | null>(); // sha -> relation label to whatever discovered it
  for (const sha of startCommits) visited.set(sha, null);

  let frontier = [...startCommits];
  for (let hop = 0; hop < hops; hop++) {
    const next: string[] = [];
    for (const sha of frontier) {
      for (const neighbor of getRelatedCommits(sqlitePath, sha)) {
        if (visited.has(neighbor.sha)) continue;
        visited.set(neighbor.sha, neighbor.relation);
        next.push(neighbor.sha);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const nodes: LineageNode[] = [];
  for (const [sha, relation] of visited) {
    const commit = getCommit(sqlitePath, sha);
    const outcome = getOutcome(sqlitePath, sha);
    const linkedSessions = getLinksForCommit(sqlitePath, sha).map((l) => l.session_id);
    const authorDate = commit?.author_date ?? null;
    const position: LineageNode["position"] = startCommits.has(sha)
      ? "self"
      : authorDate !== null && authorDate < anchorDate
        ? "before"
        : "after";

    if (direction === "forward" && position === "before") continue;
    if (direction === "backward" && position === "after") continue;

    nodes.push({
      sha,
      authorDate,
      message: commit?.message ?? null,
      outcome: outcome?.outcome ?? null,
      relationToAnchor: relation,
      linkedSessionIds: linkedSessions,
      filesTouched: getFilesForCommit(sqlitePath, sha),
      position,
    });
  }

  nodes.sort((a, b) => (a.authorDate ?? 0) - (b.authorDate ?? 0));
  return nodes;
}

export function getCommitContext(
  sqlitePath: string,
  sha: string,
): {
  commit: ReturnType<typeof getCommit>;
  outcome: ReturnType<typeof getOutcome>;
  linkedSessions: Array<{ session_id: string; slug: string | null; intent: string | null }>;
  filesTouched: string[];
} {
  const commit = getCommit(sqlitePath, sha);
  const outcome = getOutcome(sqlitePath, sha);
  const linkedSessions = getLinksForCommit(sqlitePath, sha).map((l) => {
    const session = getSession(sqlitePath, l.session_id);
    return { session_id: l.session_id, slug: session?.slug ?? null, intent: session?.intent ?? null };
  });
  const filesTouched = getFilesForCommit(sqlitePath, sha);
  return { commit, outcome, linkedSessions, filesTouched };
}
