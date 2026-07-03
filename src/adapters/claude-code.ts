import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ParsedSession, SessionAdapter, SessionRef, ToolCall, Turn } from "./types.js";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

// Best-effort reversal of Claude Code's cwd sanitization (path separators and
// drive-letter colons replaced with '-'). Not guaranteed reversible for paths
// that themselves contain '-'; only used for display, never for filesystem access.
function desanitizeProjectDir(dirName: string): string {
  return dirName.replace(/^([a-zA-Z])--/, "$1:/").replace(/-/g, "/");
}

interface RawRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  slug?: string;
  sessionId?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function extractToolCalls(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) return [];
  const calls: ToolCall[] = [];
  for (const block of content as ContentBlock[]) {
    if (block?.type !== "tool_use" || !block.name) continue;
    const input = block.input ?? {};
    const isFileEdit = ["Edit", "Write", "NotebookEdit"].includes(block.name);
    const isShellCommand = block.name === "Bash";
    calls.push({
      toolName: block.name,
      input,
      isFileEdit,
      filePath: isFileEdit ? (input.file_path as string | undefined) : undefined,
      isShellCommand,
      command: isShellCommand ? (input.command as string | undefined) : undefined,
    });
  }
  return calls;
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = (content as ContentBlock[])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string);
  return parts.length ? parts.join("\n") : undefined;
}

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly id = "claude-code";

  isAvailable(): boolean {
    return existsSync(PROJECTS_DIR);
  }

  listSessions(since?: number): SessionRef[] {
    if (!this.isAvailable()) return [];
    const refs: SessionRef[] = [];
    for (const projectDir of readdirSync(PROJECTS_DIR)) {
      const projectPath = join(PROJECTS_DIR, projectDir);
      let stat;
      try {
        stat = statSync(projectPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      for (const file of readdirSync(projectPath)) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = join(projectPath, file);
        const fileStat = statSync(filePath);
        const lastModified = fileStat.mtimeMs;
        if (since && lastModified < since) continue;
        refs.push({
          adapterId: this.id,
          sessionId: file.replace(/\.jsonl$/, ""),
          projectPath: desanitizeProjectDir(projectDir),
          lastModified,
          sizeHint: fileStat.size,
        });
      }
    }
    return refs;
  }

  loadSession(ref: SessionRef): ParsedSession {
    const projectDirName = readdirSync(PROJECTS_DIR).find(
      (d) => desanitizeProjectDir(d) === ref.projectPath,
    );
    if (!projectDirName) {
      throw new Error(`Project directory not found for ${ref.projectPath}`);
    }
    const filePath = join(PROJECTS_DIR, projectDirName, `${ref.sessionId}.jsonl`);
    const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

    const turns: Turn[] = [];
    let gitBranch: string | undefined;
    let slug: string | undefined;
    let startedAt = Infinity;
    let endedAt = 0;

    for (const line of lines) {
      let record: RawRecord;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type !== "user" && record.type !== "assistant") continue;
      if (!record.uuid || !record.message) continue;

      const ts = record.timestamp ? Date.parse(record.timestamp) : Date.now();
      startedAt = Math.min(startedAt, ts);
      endedAt = Math.max(endedAt, ts);
      gitBranch = gitBranch ?? record.gitBranch;
      slug = slug ?? record.slug;

      turns.push({
        turnId: record.uuid,
        parentTurnId: record.parentUuid ?? undefined,
        role: record.type,
        timestamp: ts,
        text: extractText(record.message.content),
        toolCalls: extractToolCalls(record.message.content),
      });
    }

    return {
      sessionId: ref.sessionId,
      adapterId: this.id,
      projectPath: ref.projectPath,
      gitBranch,
      startedAt: Number.isFinite(startedAt) ? startedAt : 0,
      endedAt,
      slug,
      turns,
    };
  }
}
