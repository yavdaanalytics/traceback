import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NormalizedSession, SessionAdapter, SessionRef, ToolCall, Turn } from "./types.js";

function projectsDir(): string {
  return process.env.TRACEBACK_CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
}

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

function parseJsonlFile(filePath: string): Turn[] {
  const turns: Turn[] = [];
  if (!existsSync(filePath)) return turns;
  const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
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
    turns.push({
      turnId: record.uuid,
      parentTurnId: record.parentUuid ?? undefined,
      role: record.type,
      timestamp: ts,
      text: extractText(record.message.content),
      toolCalls: extractToolCalls(record.message.content),
    });
  }
  return turns;
}

function loadTodos(sessionId: string): unknown[] {
  const todosDir = join(homedir(), ".claude", "todos");
  if (!existsSync(todosDir)) return [];
  const files = readdirSync(todosDir).filter((f) => f.startsWith(`${sessionId}-`) && f.endsWith(".json"));
  const todos: unknown[] = [];
  for (const f of files) {
    try {
      todos.push(JSON.parse(readFileSync(join(todosDir, f), "utf-8")));
    } catch {
      // skip
    }
  }
  return todos;
}

function loadHistoryTail(sessionId: string, maxLines = 20): unknown[] {
  const historyPath = join(homedir(), ".claude", "history.jsonl");
  if (!existsSync(historyPath)) return [];
  const lines = readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  const relevant: unknown[] = [];
  for (const line of lines.slice(-maxLines)) {
    try {
      const rec = JSON.parse(line);
      if (rec.sessionId === sessionId || rec.session_id === sessionId) relevant.push(rec);
    } catch {
      // skip
    }
  }
  return relevant;
}

function findProjectDir(projectPath: string): string | undefined {
  return readdirSync(projectsDir()).find((d) => desanitizeProjectDir(d) === projectPath);
}

function resolveTranscriptPath(projectDirName: string, sessionId: string): string {
  const sessionsPath = join(projectsDir(), projectDirName, "sessions", `${sessionId}.jsonl`);
  if (existsSync(sessionsPath)) return sessionsPath;
  return join(projectsDir(), projectDirName, `${sessionId}.jsonl`);
}

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly id = "claude-code";

  isAvailable(): boolean {
    return existsSync(projectsDir());
  }

  discover(since?: number): SessionRef[] {
    return this.listSessions(since);
  }

  parse(ref: SessionRef): NormalizedSession {
    return this.loadSession(ref);
  }

  listSessions(since?: number): SessionRef[] {
    if (!this.isAvailable()) return [];
    const refs: SessionRef[] = [];
    const seen = new Set<string>();

    for (const projectDir of readdirSync(projectsDir())) {
      const projectPath = join(projectsDir(), projectDir);
      let stat;
      try {
        stat = statSync(projectPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const scanDirs = [projectPath, join(projectPath, "sessions")];
      for (const dir of scanDirs) {
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
          if (!file.endsWith(".jsonl")) continue;
          const sessionId = file.replace(/\.jsonl$/, "");
          const dedupeKey = `${projectDir}:${sessionId}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          const filePath = join(dir, file);
          const fileStat = statSync(filePath);
          const lastModified = fileStat.mtimeMs;
          if (since && lastModified < since) continue;
          refs.push({
            adapterId: this.id,
            sessionId,
            projectPath: desanitizeProjectDir(projectDir),
            lastModified,
            sizeHint: fileStat.size,
            transcriptPath: filePath,
          });
        }
      }
    }
    return refs;
  }

  loadSession(ref: SessionRef): NormalizedSession {
    const projectDirName = findProjectDir(ref.projectPath);
    if (!projectDirName) {
      throw new Error(`Project directory not found for ${ref.projectPath}`);
    }

    const transcriptRef = ref.transcriptPath ?? resolveTranscriptPath(projectDirName, ref.sessionId);
    const turns = parseJsonlFile(transcriptRef);

    const subagentsDir = join(projectsDir(), projectDirName, ref.sessionId, "subagents");
    if (existsSync(subagentsDir)) {
      for (const file of readdirSync(subagentsDir)) {
        if (!file.startsWith("agent-") || !file.endsWith(".jsonl")) continue;
        turns.push(...parseJsonlFile(join(subagentsDir, file)));
      }
    }

    let gitBranch: string | undefined;
    let slug: string | undefined;
    let startedAt = Infinity;
    let endedAt = 0;
    for (const t of turns) {
      startedAt = Math.min(startedAt, t.timestamp);
      endedAt = Math.max(endedAt, t.timestamp);
    }

    const mainLines = readFileSync(transcriptRef, "utf-8").split("\n").filter(Boolean);
    for (const line of mainLines) {
      try {
        const record = JSON.parse(line) as RawRecord;
        gitBranch = gitBranch ?? record.gitBranch;
        slug = slug ?? record.slug;
      } catch {
        continue;
      }
    }

    const metadata = {
      todos: loadTodos(ref.sessionId),
      history: loadHistoryTail(ref.sessionId),
    };

    return {
      sessionId: ref.sessionId,
      adapterId: this.id,
      projectPath: ref.projectPath,
      gitBranch,
      startedAt: Number.isFinite(startedAt) ? startedAt : 0,
      endedAt,
      slug,
      turns,
      transcriptRef,
      segmentIndex: 0,
      sourceFileKey: `${this.id}:${ref.sessionId}:seg-0`,
      metadata: metadata.todos.length || metadata.history.length ? metadata : undefined,
    };
  }
}
