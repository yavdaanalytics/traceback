import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { defaultSqlitePath } from "../ingest/indexer.js";

export interface RegisteredRepo {
  repoRoot: string;
  sqlitePath: string;
}

function registryPath(): string {
  return join(homedir(), ".traceback", "repos.json");
}

export function listRegisteredRepos(): RegisteredRepo[] {
  const path = registryPath();
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8")) as RegisteredRepo[];
}

// Idempotent: adding an already-known repoRoot is a no-op.
export function registerRepo(repoRoot: string): void {
  const path = registryPath();
  const repos = listRegisteredRepos();
  if (repos.some((r) => r.repoRoot === repoRoot)) return;
  repos.push({ repoRoot, sqlitePath: defaultSqlitePath(repoRoot) });
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(repos, null, 2));
}
