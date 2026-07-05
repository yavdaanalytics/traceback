import { execFileSync } from "node:child_process";

// Pure heuristic: extract search terms from a natural-language query for git log pickaxe.
// Order: quoted substrings, path-like tokens (/ or .), identifier-like tokens (_/camelCase/CAPS),
// else top 3 longest words. Returns at most 5 terms (avoid bloat in git log -S calls).
export function deriveSearchTerms(query: string): string[] {
  const terms = new Set<string>();

  // Quoted substrings: "error message" -> "error message"
  const quotedMatches = query.match(/"([^"]+)"/g);
  if (quotedMatches) {
    for (const m of quotedMatches) {
      const inner = m.slice(1, -1).trim();
      if (inner.length > 0) terms.add(inner);
    }
  }

  // Path-like tokens: contains / or .
  const pathLike = query.split(/\s+/).filter((t) => (t.includes("/") || t.includes(".")) && t.length > 0);
  for (const p of pathLike) {
    terms.add(p);
  }

  // Identifier-like tokens: contains _ or camelCase (has lowercase followed by uppercase) or ALL_CAPS
  const identifierLike = query.split(/\s+/).filter((t) => {
    if (t.length === 0) return false;
    if (t.includes("_")) return true;
    if (/[a-z][A-Z]/.test(t)) return true; // camelCase
    if (/^[A-Z_]+$/.test(t)) return true; // ALL_CAPS
    return false;
  });
  for (const id of identifierLike) {
    terms.add(id);
  }

  // Fallback: top 3 longest words
  if (terms.size === 0) {
    const words = query
      .split(/\s+/)
      .filter((w) => w.length > 3) // skip short filler words
      .sort((a, b) => b.length - a.length)
      .slice(0, 3);
    for (const w of words) {
      terms.add(w);
    }
  }

  // Cap at 5 total to avoid git log spawn bloat
  return Array.from(terms).slice(0, 5);
}

export interface GitHistoryScopeResult {
  commit_hash: string;
  message: string;
  files_changed: string[];
  date: string;
  term_hits: number;
  source: "blame" | "git_history";
}

// Cold-start scoping via git log (pickaxe) and git blame. Returns top-N commits that
// touched code related to the given search terms, ranked by term-hit count descending
// and author_date descending. Used as scope narrowing for grep when session-vector
// search has no confident match or finds nothing.
export function gitHistoryScope(
  repoPath: string,
  terms: string[],
  opts?: { file?: string; line?: number },
): GitHistoryScopeResult[] {
  const candidates = new Map<string, { commit_hash: string; message: string; date: string; term_hits: number }>();

  // If a specific file/line is given, run blame first to find the most recent commit.
  if (opts?.file) {
    try {
      const lineArg = opts.line ? `${opts.line},${opts.line}` : "1,1"; // default to first line if no line given
      const blameOut = execFileSync("git", ["blame", "-w", "-C", "-L", lineArg, "HEAD", "--", opts.file], {
        cwd: repoPath,
        encoding: "utf-8",
      });
      // Parse porcelain blame output: first non-whitespace token is commit sha (or partial)
      const lines = blameOut.trim().split("\n");
      if (lines.length > 0) {
        const firstLineTokens = lines[0].split(/\s+/);
        if (firstLineTokens.length > 0) {
          const sha = firstLineTokens[0].replace(/^\^/, ""); // ^ prefix means boundary commit
          candidates.set(sha, {
            commit_hash: sha,
            message: "", // will fetch via git log if this sha ranks high
            date: "",
            term_hits: 0,
          });
        }
      }
    } catch (err) {
      // Blame failure is non-fatal (file may not exist in HEAD, etc.)
      void err;
    }
  }

  // For each search term, run git log -S (pickaxe) to find commits that added/removed it.
  for (const term of terms) {
    try {
      const out = execFileSync(
        "git",
        [
          "log",
          "--follow",
          "-S",
          term,
          "--name-only",
          "--format=COMMIT|%H|%aI|%s",
          "--date=iso",
          "--",
          opts?.file ?? ".",
        ],
        { cwd: repoPath, encoding: "utf-8" },
      );

      // Parse output: blocks of "COMMIT|sha|date|subject" followed by file lines
      const blocks = out.split(/\nCOMMIT\|/);
      for (let i = 0; i < blocks.length; i++) {
        const block = (i === 0 ? blocks[i] : `COMMIT|${blocks[i]}`).trim();
        if (!block.startsWith("COMMIT|")) continue;
        const lines = block.split("\n");
        if (lines.length === 0) continue;
        const headerParts = lines[0].replace(/^COMMIT\|/, "").split("|");
        if (headerParts.length < 3) continue;
        const sha = headerParts[0];
        const date = headerParts[1];
        const subject = headerParts.slice(2).join("|"); // in case subject has |

        const existing = candidates.get(sha);
        const newHits = (existing?.term_hits ?? 0) + 1;
        candidates.set(sha, {
          commit_hash: sha,
          message: subject,
          date,
          term_hits: newHits,
        });
      }
    } catch (err) {
      // Pickaxe failure is non-fatal (term may not exist, etc.)
      void err;
    }
  }

  // Rank by term_hits desc, then date desc, return top 5
  const sorted = Array.from(candidates.values())
    .sort((a, b) => {
      if (b.term_hits !== a.term_hits) return b.term_hits - a.term_hits;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    })
    .slice(0, 5);

  // For each top commit, fetch its changed files
  const results: GitHistoryScopeResult[] = [];
  for (const cand of sorted) {
    let filesChanged: string[] = [];
    try {
      const filesOut = execFileSync("git", ["show", "--name-only", "--format=", cand.commit_hash], {
        cwd: repoPath,
        encoding: "utf-8",
      });
      filesChanged = filesOut
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);
    } catch (err) {
      // If show fails, just continue with empty files list
      void err;
    }
    results.push({
      commit_hash: cand.commit_hash,
      message: cand.message,
      files_changed: filesChanged,
      date: cand.date,
      term_hits: cand.term_hits,
      source: "git_history",
    });
  }

  return results;
}
