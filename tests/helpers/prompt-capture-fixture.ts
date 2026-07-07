import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const PROMPT_CAPTURE_SESSION_ID = "prompt-capture-session";
export const PROMPT_CAPTURE_QUERY = "oauth authentication token refresh logout";
export const PROMPT_CAPTURE_USER_TEXT =
  "Fix OAuth authentication token refresh loop causing users to be logged out";

/** Claude Code encodes project paths as e.g. `c--source-traceback`. */
export function encodeClaudeProjectDir(projectPath: string): string {
  return projectPath
    .replace(/\\/g, "/")
    .replace(/^([a-zA-Z]):\//, "$1--")
    .replace(/\//g, "-");
}

export function buildCaptureJsonl(sessionId: string, projectPath: string, now = Date.now()): string {
  const cwd = projectPath.replace(/\\/g, "/");
  const t0 = new Date(now - 120_000).toISOString();
  const t1 = new Date(now - 60_000).toISOString();
  const lines = [
    {
      type: "user",
      uuid: "pc-u1",
      parentUuid: null,
      timestamp: t0,
      cwd,
      gitBranch: "main",
      slug: "oauth-token-fix",
      sessionId,
      message: {
        role: "user",
        content: [{ type: "text", text: PROMPT_CAPTURE_USER_TEXT }],
      },
    },
    {
      type: "assistant",
      uuid: "pc-a1",
      parentUuid: "pc-u1",
      timestamp: t1,
      cwd,
      sessionId,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Updating the token refresh handler" },
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "src/auth.ts" },
          },
        ],
      },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

export interface PromptCaptureFixture {
  rootDir: string;
  repoDir: string;
  claudeProjectsDir: string;
  dataDir: string;
  sqlitePath: string;
  headSha: string;
}

export function installPromptCaptureFixture(): PromptCaptureFixture {
  const rootDir = mkdtempSync(join(tmpdir(), "tbpc"));
  const repoDir = join(rootDir, "repo");
  const claudeProjectsDir = join(rootDir, "claude-projects");
  const dataDir = join(repoDir, "data", "lancedb");
  const sqlitePath = join(repoDir, "data", "traceback.db");

  mkdirSync(join(repoDir, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "traceback@test.local"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Traceback Test"], { cwd: repoDir });

  writeFileSync(join(repoDir, "readme.txt"), "fixture\n", "utf-8");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });

  writeFileSync(
    join(repoDir, "src", "auth.ts"),
    "export function refreshOAuthToken() { return 'token'; }\n",
    "utf-8",
  );
  execFileSync("git", ["add", "src/auth.ts"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "fix oauth token refresh loop"], { cwd: repoDir });

  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();

  const encoded = encodeClaudeProjectDir(repoDir);
  const sessionsDir = join(claudeProjectsDir, encoded, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const jsonlPath = join(sessionsDir, `${PROMPT_CAPTURE_SESSION_ID}.jsonl`);
  const now = Date.now();
  writeFileSync(jsonlPath, buildCaptureJsonl(PROMPT_CAPTURE_SESSION_ID, repoDir, now), "utf-8");
  const mtime = new Date(now);
  utimesSync(jsonlPath, mtime, mtime);

  process.env.TRACEBACK_CLAUDE_PROJECTS_DIR = claudeProjectsDir;
  // Isolate from developer machine Cursor/Copilot stores during automated capture tests.
  process.env.TRACEBACK_CURSOR_STORAGE = join(rootDir, "no-cursor-storage");
  process.env.TRACEBACK_COPILOT_STORAGE = join(rootDir, "no-copilot-storage");

  return { rootDir, repoDir, claudeProjectsDir, dataDir, sqlitePath, headSha };
}
