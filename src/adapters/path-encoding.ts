import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Claude Code ~/.claude/projects folder names: `c--` after drive, then `-` for path slashes. */
export function encodeClaudeProjectDir(projectPath: string): string {
  return projectPath
    .replace(/\\/g, "/")
    .replace(/\/$/, "")
    .replace(/^([a-zA-Z]):\//, "$1--")
    .replace(/\//g, "-");
}

/** Claude Code encodes project paths as e.g. `c--source-traceback`. */
export function decodeClaudeProjectDir(dirName: string): string {
  const match = /^([a-zA-Z])--(.+)$/.exec(dirName);
  if (!match) return dirName;
  const drive = match[1].toLowerCase();
  const tokens = match[2].split("-");
  const resolved = resolvePathFromEncodedTokens(drive, tokens);
  if (resolved) return resolved;
  return osPathFromSegments(drive, tokens);
}

export function claudeProjectsDir(): string {
  return process.env.TRACEBACK_CLAUDE_PROJECTS_DIR?.trim() || join(homedir(), ".claude", "projects");
}

/** Cursor ~/.cursor/projects folder names: drive + path with `/` replaced by `-`. */
export function encodeCursorProjectDir(projectPath: string): string {
  const norm = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const match = /^([a-zA-Z]):\/(.*)$/.exec(norm);
  if (!match) return norm.replace(/\//g, "-");
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\//g, "-");
  return `${drive}-${rest}`;
}

function osPathFromSegments(drive: string, segments: string[]): string {
  if (process.platform === "win32") {
    if (segments.length === 0) return `${drive.toUpperCase()}:\\`;
    return `${drive.toUpperCase()}:\\${segments.join("\\")}`;
  }
  if (segments.length === 0) return `/${drive}/`;
  return `/${segments.join("/")}`;
}

function resolvePathFromEncodedTokens(drive: string, tokens: string[]): string | undefined {
  const n = tokens.length;

  function dfs(index: number, segments: string[]): string | undefined {
    if (index === n) {
      const candidate = osPathFromSegments(drive, segments);
      return existsSync(candidate) ? candidate : undefined;
    }
    for (let end = index + 1; end <= n; end++) {
      const segment = tokens.slice(index, end).join("-");
      const found = dfs(end, [...segments, segment]);
      if (found) return found;
    }
    return undefined;
  }

  return dfs(0, []);
}

/** Decode Cursor project folder name back to a filesystem path. */
export function decodeCursorProjectDir(dirName: string): string {
  const match = /^([a-zA-Z])-(.+)$/.exec(dirName);
  if (!match) return dirName;
  const drive = match[1].toLowerCase();
  const tokens = match[2].split("-");
  const resolved = resolvePathFromEncodedTokens(drive, tokens);
  if (resolved) return resolved;
  return osPathFromSegments(drive, tokens);
}

export function cursorProjectsDir(): string {
  return process.env.TRACEBACK_CURSOR_PROJECTS_DIR?.trim() || join(homedir(), ".cursor", "projects");
}

export function copilotSessionStateDir(): string {
  return process.env.TRACEBACK_COPILOT_SESSION_STATE_DIR?.trim() || join(homedir(), ".copilot", "session-state");
}

/** True when projects root exists and at least one child has agent-transcripts/. */
export function hasCursorProjectsTranscripts(projectsRoot: string = cursorProjectsDir()): boolean {
  if (!existsSync(projectsRoot)) return false;
  try {
    for (const name of readdirSync(projectsRoot)) {
      if (existsSync(join(projectsRoot, name, "agent-transcripts"))) return true;
    }
  } catch {
    return false;
  }
  return false;
}
