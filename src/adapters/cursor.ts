import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NormalizedSession, SessionAdapter, SessionRef, ToolCall, Turn } from "./types.js";
import {
  cursorProjectsDir,
  decodeCursorProjectDir,
  hasCursorProjectsTranscripts,
} from "./path-encoding.js";

function cursorStorageRoot(): string {
  return (
    process.env.TRACEBACK_CURSOR_STORAGE ??
    (process.platform === "win32"
      ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Cursor", "User")
      : join(homedir(), ".config", "Cursor", "User"))
  );
}

function readVscdbValue(dbPath: string, key: string): string | undefined {
  if (!existsSync(dbPath)) return undefined;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT value FROM ItemTable WHERE key = $key`).get({ key }) as
      | { value: string | Buffer }
      | undefined;
    if (!row || row.value == null) return undefined;
    return typeof row.value === "string" ? row.value : row.value.toString("utf-8");
  } catch {
    return undefined;
  }
}

function resolveProjectPath(workspaceHash: string, storageRoot: string): string {
  const wsJson = join(storageRoot, "workspaceStorage", workspaceHash, "workspace.json");
  if (!existsSync(wsJson)) return workspaceHash;
  try {
    const parsed = JSON.parse(readFileSync(wsJson, "utf-8")) as { folder?: string };
    if (parsed.folder) return decodeURIComponent(parsed.folder.replace(/^file:\/\//, ""));
  } catch {
    // fall through
  }
  return workspaceHash;
}

interface CursorSession {
  sessionId: string;
  projectPath: string;
  lastModified: number;
  transcriptPath: string;
  turns: Turn[];
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function extractToolCallsFromContent(content: unknown): ToolCall[] {
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

function extractTextFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = (content as ContentBlock[])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string);
  return parts.length ? parts.join("\n") : undefined;
}

function parseComposerData(raw: string, composerId: string, projectPath: string, transcriptPath: string): CursorSession | undefined {
  try {
    const data = JSON.parse(raw) as {
      composerId?: string;
      conversation?: Array<{ type?: string | number; text?: string; bubbleId?: string; timestamp?: number }>;
      tabs?: Array<{ bubbles?: Array<{ type?: string; text?: string; bubbleId?: string }> }>;
    };
    const turns: Turn[] = [];
    const conv = data.conversation ?? data.tabs?.flatMap((t) => t.bubbles ?? []) ?? [];
    let i = 0;
    for (const bubble of conv) {
      const role = bubble.type === "user" || bubble.type === 1 ? "user" : "assistant";
      turns.push({
        turnId: bubble.bubbleId ?? `${composerId}-${i}`,
        role: role as "user" | "assistant",
        timestamp: "timestamp" in bubble && bubble.timestamp != null ? bubble.timestamp : Date.now(),
        text: bubble.text,
        toolCalls: [],
      });
      i++;
    }
    if (turns.length === 0) return undefined;
    const lastModified = Math.max(...turns.map((t) => t.timestamp));
    return { sessionId: composerId, projectPath, lastModified, transcriptPath, turns };
  } catch {
    return undefined;
  }
}

export function parseAgentTranscriptJsonl(
  raw: string,
  sessionId: string,
  projectPath: string,
  transcriptPath: string,
  fileMtimeMs: number,
): CursorSession | undefined {
  const turns: Turn[] = [];
  let lineIndex = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record: {
      role?: string;
      type?: string;
      message?: { content?: unknown };
      timestamp?: number;
    };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type && record.type !== "user" && record.type !== "assistant" && !record.role) {
      continue;
    }
    const role = record.role === "user" || record.role === "assistant" ? record.role : undefined;
    if (!role || !record.message) continue;
    const text = extractTextFromContent(record.message.content);
    const toolCalls = extractToolCallsFromContent(record.message.content);
    if (!text && toolCalls.length === 0) continue;
    turns.push({
      turnId: `${sessionId}-${lineIndex}`,
      role,
      timestamp: record.timestamp ?? fileMtimeMs,
      text,
      toolCalls,
    });
    lineIndex++;
  }
  if (turns.length === 0) return undefined;
  const lastModified = Math.max(fileMtimeMs, ...turns.map((t) => t.timestamp));
  return { sessionId, projectPath, lastModified, transcriptPath, turns };
}

function scanWorkspaceStorage(storageRoot: string, since?: number): CursorSession[] {
  const results: CursorSession[] = [];
  const wsDir = join(storageRoot, "workspaceStorage");
  if (!existsSync(wsDir)) return results;

  for (const hash of readdirSync(wsDir)) {
    const vscdb = join(wsDir, hash, "state.vscdb");
    if (!existsSync(vscdb)) continue;
    const projectPath = resolveProjectPath(hash, storageRoot);
    const keys = [
      "composer.composerData",
      "workbench.panel.aichat.view.aichat.chatdata",
    ];
    for (const key of keys) {
      const raw = readVscdbValue(vscdb, key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const composers = Array.isArray(parsed) ? parsed : parsed.composers ?? [parsed];
        for (const c of composers) {
          const composerId = c.composerId ?? c.id ?? hash;
          const session = parseComposerData(JSON.stringify(c), composerId, projectPath, vscdb);
          if (!session) continue;
          if (since && session.lastModified < since) continue;
          results.push(session);
        }
      } catch {
        const session = parseComposerData(raw, hash, projectPath, vscdb);
        if (session && (!since || session.lastModified >= since)) results.push(session);
      }
    }
  }
  return results;
}

function scanGlobalStorage(storageRoot: string, since?: number): CursorSession[] {
  const results: CursorSession[] = [];
  const globalDb = join(storageRoot, "globalStorage", "state.vscdb");
  if (!existsSync(globalDb)) return results;

  const db = new DatabaseSync(globalDb, { readOnly: true });
  let rows: Array<{ key: string; value: string | Buffer }> = [];
  try {
    rows = db
      .prepare(`SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
      .all() as Array<{ key: string; value: string | Buffer }>;
  } catch {
    return results;
  }

  for (const row of rows) {
    if (row.value == null) continue;
    const composerId = row.key.replace("composerData:", "");
    const raw = typeof row.value === "string" ? row.value : row.value.toString("utf-8");
    const session = parseComposerData(raw, composerId, "global", globalDb);
    if (!session) continue;
    if (since && session.lastModified < since) continue;
    results.push(session);
  }
  return results;
}

export function scanCursorProjects(projectsRoot: string, since?: number): CursorSession[] {
  const results: CursorSession[] = [];
  if (!existsSync(projectsRoot)) return results;

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsRoot);
  } catch {
    return results;
  }

  for (const projectDirName of projectDirs) {
    const transcriptsDir = join(projectsRoot, projectDirName, "agent-transcripts");
    if (!existsSync(transcriptsDir)) continue;
    const projectPath = decodeCursorProjectDir(projectDirName);

    let sessionDirs: string[];
    try {
      sessionDirs = readdirSync(transcriptsDir);
    } catch {
      continue;
    }

    for (const sessionId of sessionDirs) {
      const transcriptPath = join(transcriptsDir, sessionId, `${sessionId}.jsonl`);
      if (!existsSync(transcriptPath)) continue;
      let raw: string;
      let fileMtimeMs: number;
      try {
        raw = readFileSync(transcriptPath, "utf-8");
        fileMtimeMs = statSync(transcriptPath).mtimeMs;
      } catch {
        continue;
      }
      const session = parseAgentTranscriptJsonl(raw, sessionId, projectPath, transcriptPath, fileMtimeMs);
      if (!session) continue;
      if (since && session.lastModified < since) continue;
      results.push(session);
    }
  }
  return results;
}

function collectAllSessions(since?: number): CursorSession[] {
  const storageRoot = cursorStorageRoot();
  const projectsRoot = cursorProjectsDir();
  return [
    ...scanWorkspaceStorage(storageRoot, since),
    ...scanGlobalStorage(storageRoot, since),
    ...scanCursorProjects(projectsRoot, since),
  ];
}

export class CursorAdapter implements SessionAdapter {
  readonly id = "cursor";

  isAvailable(): boolean {
    return existsSync(cursorStorageRoot()) || hasCursorProjectsTranscripts();
  }

  discover(since?: number): SessionRef[] {
    return this.listSessions(since);
  }

  parse(ref: SessionRef): NormalizedSession {
    return this.loadSession(ref);
  }

  listSessions(since?: number): SessionRef[] {
    if (!this.isAvailable()) return [];
    const byId = new Map<string, SessionRef>();

    for (const session of collectAllSessions(since)) {
      const existing = byId.get(session.sessionId);
      if (!existing || session.lastModified > existing.lastModified) {
        byId.set(session.sessionId, {
          adapterId: this.id,
          sessionId: session.sessionId,
          projectPath: session.projectPath,
          lastModified: session.lastModified,
          sizeHint: session.turns.length,
          transcriptPath: session.transcriptPath,
        });
      }
    }
    return Array.from(byId.values());
  }

  loadSession(ref: SessionRef): NormalizedSession {
    const match = collectAllSessions().find((s) => s.sessionId === ref.sessionId);
    if (!match) {
      throw new Error(`CursorAdapter.loadSession: session ${ref.sessionId} not found`);
    }
    const startedAt = Math.min(...match.turns.map((t) => t.timestamp));
    const endedAt = Math.max(...match.turns.map((t) => t.timestamp));
    return {
      sessionId: ref.sessionId,
      adapterId: this.id,
      projectPath: match.projectPath,
      startedAt,
      endedAt,
      turns: match.turns,
      transcriptRef: match.transcriptPath,
      segmentIndex: 0,
      sourceFileKey: `${this.id}:${ref.sessionId}:seg-0`,
    };
  }
}

/** Test helper: build a minimal Cursor fixture vscdb. */
export function buildCursorFixtureVscdb(dirPath: string, composerData: unknown): void {
  mkdirSync(dirPath, { recursive: true });
  const db = new DatabaseSync(join(dirPath, "state.vscdb"));
  db.exec(`CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)`);
  db.prepare(`INSERT OR REPLACE INTO ItemTable (key, value) VALUES ($key, $value)`).run({
    key: "composer.composerData",
    value: JSON.stringify(composerData),
  });
}

/** Test helper: insert a vscdb key with SQL NULL value (regression fixture). */
export function buildCursorFixtureVscdbNullValue(
  dirPath: string,
  key = "composer.composerData",
): void {
  mkdirSync(dirPath, { recursive: true });
  const db = new DatabaseSync(join(dirPath, "state.vscdb"));
  db.exec(`CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)`);
  db.prepare(`INSERT OR REPLACE INTO ItemTable (key, value) VALUES ($key, $value)`).run({
    key,
    value: null,
  });
}

/** Test helper: write agent-transcripts jsonl under projects root. */
export function buildCursorProjectsTranscriptFixture(
  projectsRoot: string,
  projectDirName: string,
  sessionId: string,
  lines: string[],
): string {
  const transcriptPath = join(
    projectsRoot,
    projectDirName,
    "agent-transcripts",
    sessionId,
    `${sessionId}.jsonl`,
  );
  mkdirSync(join(projectsRoot, projectDirName, "agent-transcripts", sessionId), { recursive: true });
  writeFileSync(transcriptPath, lines.join("\n"), "utf-8");
  return transcriptPath;
}
