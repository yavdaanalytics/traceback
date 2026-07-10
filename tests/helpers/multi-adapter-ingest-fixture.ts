import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCursorProjectsTranscriptFixture } from "../../src/adapters/cursor.js";
import { encodeClaudeProjectDir, encodeCursorProjectDir } from "../../src/adapters/path-encoding.js";
import { defaultDataDir, defaultSqlitePath } from "../../src/ingest/indexer.js";

export const MULTI_CLAUDE_SESSION_A = "multi-claude-session-a";
export const MULTI_CLAUDE_SESSION_B = "multi-claude-session-b";
export const MULTI_CURSOR_SESSION = "multi-cursor-session-11111111-2222-3333-4444-555555555555";
export const MULTI_COPILOT_SESSION = "multi-copilot-session-22222222-3333-4444-5555-666666666666";

export interface MultiAdapterIngestFixture {
  rootDir: string;
  repoDir: string;
  sqlitePath: string;
  dataDir: string;
}

function buildClaudeJsonl(sessionId: string, repoDir: string, userText: string, now: number): string {
  const cwd = repoDir.replace(/\\/g, "/");
  const t0 = new Date(now - 120_000).toISOString();
  const t1 = new Date(now - 60_000).toISOString();
  return [
    JSON.stringify({
      type: "user",
      uuid: `${sessionId}-u`,
      parentUuid: null,
      timestamp: t0,
      cwd,
      sessionId,
      message: { role: "user", content: [{ type: "text", text: userText }] },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: `${sessionId}-a`,
      parentUuid: `${sessionId}-u`,
      timestamp: t1,
      cwd,
      sessionId,
      message: {
        role: "assistant",
        content: [{ type: "text", text: `Handled: ${userText}` }],
      },
    }),
  ].join("\n");
}

export function installMultiAdapterIngestFixture(now = Date.now()): MultiAdapterIngestFixture {
  const rootDir = mkdtempSync(join(tmpdir(), "tb-multi-ingest-"));
  const repoDir = join(rootDir, "repo");
  const claudeProjectsDir = join(rootDir, "claude-projects");
  const cursorProjectsDir = join(rootDir, "cursor-projects");
  const copilotSessionStateDir = join(rootDir, "copilot-session-state");
  const dataDir = defaultDataDir(repoDir);
  const sqlitePath = defaultSqlitePath(repoDir);

  mkdirSync(join(repoDir, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "traceback@test.local"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Traceback Test"], { cwd: repoDir });
  writeFileSync(join(repoDir, "readme.txt"), "multi-adapter fixture\n", "utf-8");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });

  const encodedClaude = encodeClaudeProjectDir(repoDir);
  const claudeProjectDir = join(claudeProjectsDir, encodedClaude, "sessions");
  mkdirSync(claudeProjectDir, { recursive: true });

  for (const [sessionId, text] of [
    [MULTI_CLAUDE_SESSION_A, "Claude OAuth token refresh in src/auth.ts"],
    [MULTI_CLAUDE_SESSION_B, "Claude JWT expiry handler follow-up"],
  ] as const) {
    const jsonlPath = join(claudeProjectDir, `${sessionId}.jsonl`);
    writeFileSync(jsonlPath, buildClaudeJsonl(sessionId, repoDir, text, now), "utf-8");
    utimesSync(jsonlPath, new Date(now), new Date(now));
  }

  buildCursorProjectsTranscriptFixture(
    cursorProjectsDir,
    encodeCursorProjectDir(repoDir),
    MULTI_CURSOR_SESSION,
    [
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "Cursor agent OAuth debugging" }] },
      }),
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "text", text: "Inspecting auth module in Cursor" }] },
      }),
    ],
  );

  const copilotDir = join(copilotSessionStateDir, MULTI_COPILOT_SESSION);
  mkdirSync(copilotDir, { recursive: true });
  writeFileSync(
    join(copilotDir, "workspace.yaml"),
    [
      `id: ${MULTI_COPILOT_SESSION}`,
      `git_root: ${repoDir.replace(/\\/g, "/")}`,
      `cwd: ${repoDir.replace(/\\/g, "/")}`,
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(copilotDir, "events.jsonl"),
    [
      JSON.stringify({
        type: "user.message",
        data: { content: "Copilot agent OAuth session fix" },
        timestamp: new Date(now - 30_000).toISOString(),
      }),
      JSON.stringify({
        type: "assistant.message",
        data: { content: "Reviewing token refresh in Copilot agent" },
        timestamp: new Date(now - 15_000).toISOString(),
      }),
    ].join("\n"),
    "utf-8",
  );

  process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = claudeProjectsDir;
  process.env.TRACEBACK_CURSOR_PROJECTS_DIR = cursorProjectsDir;
  process.env.TRACEBACK_COPILOT_SESSION_STATE_DIR = copilotSessionStateDir;
  process.env.TRACEBACK_CURSOR_STORAGE = join(rootDir, "no-cursor-vscdb");
  process.env.TRACEBACK_COPILOT_STORAGE = join(rootDir, "no-copilot-vscode");

  return { rootDir, repoDir, sqlitePath, dataDir };
}
