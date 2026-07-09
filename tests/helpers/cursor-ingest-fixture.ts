import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCursorFixtureVscdb,
  buildCursorFixtureVscdbNullValue,
} from "../../src/adapters/cursor.js";
import { defaultDataDir, defaultSqlitePath } from "../../src/ingest/indexer.js";

export const CURSOR_INGEST_SESSION_ID = "cursor-ingest-session";

function fileUriForPath(projectPath: string): string {
  const norm = projectPath.replace(/\\/g, "/");
  return norm.match(/^[a-zA-Z]:/) ? `file:///${norm}` : `file://${norm}`;
}

export interface CursorIngestFixture {
  rootDir: string;
  repoDir: string;
  cursorStorage: string;
  dataDir: string;
  sqlitePath: string;
  headSha: string;
}

/** Isolated git repo + Cursor workspaceStorage (poisoned + valid) for ingest/hook tests. */
export function installCursorIngestFixture(now = Date.now()): CursorIngestFixture {
  const rootDir = mkdtempSync(join(tmpdir(), "tb-cursor-ingest-"));
  const repoDir = join(rootDir, "repo");
  const cursorStorage = join(rootDir, "cursor-storage");
  const dataDir = defaultDataDir(repoDir);
  const sqlitePath = defaultSqlitePath(repoDir);

  mkdirSync(join(repoDir, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "traceback@test.local"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Traceback Test"], { cwd: repoDir });

  writeFileSync(join(repoDir, "readme.txt"), "fixture\n", "utf-8");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });

  writeFileSync(join(repoDir, "src", "app.ts"), "export const v = 1;\n", "utf-8");
  execFileSync("git", ["add", "src/app.ts"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "add app"], { cwd: repoDir });

  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
  const folderUri = fileUriForPath(repoDir);

  const poisonHash = "poison-ws-null";
  const goodHash = "good-ws-valid";
  const poisonDir = join(cursorStorage, "workspaceStorage", poisonHash);
  const goodDir = join(cursorStorage, "workspaceStorage", goodHash);

  mkdirSync(poisonDir, { recursive: true });
  mkdirSync(goodDir, { recursive: true });
  writeFileSync(join(poisonDir, "workspace.json"), JSON.stringify({ folder: folderUri }), "utf-8");
  writeFileSync(join(goodDir, "workspace.json"), JSON.stringify({ folder: folderUri }), "utf-8");

  buildCursorFixtureVscdbNullValue(poisonDir, "composer.composerData");
  buildCursorFixtureVscdbNullValue(poisonDir, "workbench.panel.aichat.view.aichat.chatdata");
  buildCursorFixtureVscdb(goodDir, {
    composerId: CURSOR_INGEST_SESSION_ID,
    conversation: [
      {
        type: "user",
        text: "Fix OAuth token refresh in src/app.ts",
        bubbleId: "cu-b1",
        timestamp: now - 60_000,
      },
      {
        type: "assistant",
        text: "Updated the refresh handler",
        bubbleId: "cu-b2",
        timestamp: now - 30_000,
      },
    ],
  });

  const vscdbPath = join(goodDir, "state.vscdb");
  const mtime = new Date(now);
  utimesSync(vscdbPath, mtime, mtime);

  process.env.TRACEBACK_CURSOR_STORAGE = cursorStorage;
  process.env.TRACEBACK_COPILOT_STORAGE = join(rootDir, "no-copilot-storage");
  process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = join(rootDir, "no-claude-projects");

  return { rootDir, repoDir, cursorStorage, dataDir, sqlitePath, headSha };
}
