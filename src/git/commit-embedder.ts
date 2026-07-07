import { execFileSync } from "node:child_process";
import { embedText } from "../embedding/embedder.js";
import { upsertCommitEmbeddings, type CommitEmbeddingRow } from "../storage/lancedb.js";
import { getIndexState, setIndexState } from "../storage/sqlite.js";
import { recordCommit } from "./linkage.js";

const INDEX_KEY = "last_indexed_commit";

let indexingPromise: Promise<number> | undefined;

export function kickOffCommitEmbeddingIndex(
  dataDir: string,
  sqlitePath: string,
  repoPath: string,
): void {
  if (indexingPromise) return;
  indexingPromise = indexCommitsIncremental(dataDir, sqlitePath, repoPath).catch(() => 0);
}

export async function indexCommitsIncremental(
  dataDir: string,
  sqlitePath: string,
  repoPath: string,
): Promise<number> {
  const lastSha = getIndexState(sqlitePath, INDEX_KEY);
  let logRange: string[];
  try {
    if (lastSha) {
      const range = lastSha + "..HEAD";
      const out = execFileSync("git", ["log", "--pretty=%H", range], {
        cwd: repoPath,
        encoding: "utf-8",
      });
      logRange = out.trim().split("\n").filter(Boolean).reverse();
    } else {
      const out = execFileSync("git", ["log", "--pretty=%H", "-n", "50"], {
        cwd: repoPath,
        encoding: "utf-8",
      });
      logRange = out.trim().split("\n").filter(Boolean).reverse();
    }
  } catch {
    return 0;
  }

  let indexed = 0;
  for (const sha of logRange) {
    recordCommit(sqlitePath, repoPath, sha);
    const showOut = execFileSync("git", ["show", "-s", "--format=%s", sha], {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
    let filesSummary = "";
    try {
      filesSummary = execFileSync("git", ["show", "--name-only", "--format=", sha], {
        cwd: repoPath,
        encoding: "utf-8",
      })
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(0, 20)
        .join(", ");
    } catch {
      // skip
    }
    const embedInput = `${showOut}\nFiles: ${filesSummary}`;
    const vector = await embedText(embedInput);
    const row: CommitEmbeddingRow = {
      id: sha,
      commit_sha: sha,
      session_id: "",
      repo_path: repoPath,
      message: showOut,
      files_changed_summary: filesSummary,
      vector,
      timestamp: Date.now(),
    };
    await upsertCommitEmbeddings(dataDir, [row]);
    setIndexState(sqlitePath, INDEX_KEY, sha);
    indexed++;
  }
  return indexed;
}
