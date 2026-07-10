import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NormalizedSession, SessionAdapter, SessionRef, Turn } from "./types.js";
import { copilotSessionStateDir } from "./path-encoding.js";

function copilotStorageRoot(): string {
  return (
    process.env.TRACEBACK_COPILOT_STORAGE ??
    (process.platform === "win32"
      ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Code", "User")
      : join(homedir(), ".config", "Code", "User"))
  );
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

interface CopilotSession {
  sessionId: string;
  projectPath: string;
  lastModified: number;
  transcriptPath: string;
  turns: Turn[];
}

function parseChatSessionJson(raw: string, sessionId: string, projectPath: string, filePath: string): {
  turns: Turn[];
  lastModified: number;
} | undefined {
  try {
    const data = JSON.parse(raw) as {
      sessionId?: string;
      requests?: Array<{ message?: { text?: string }; response?: Array<{ value?: string }> }>;
      creationDate?: number;
      lastMessageDate?: number;
    };
    const turns: Turn[] = [];
    for (const [i, req] of (data.requests ?? []).entries()) {
      if (req.message?.text) {
        turns.push({
          turnId: `${sessionId}-user-${i}`,
          role: "user",
          timestamp: data.creationDate ?? Date.now(),
          text: req.message.text,
          toolCalls: [],
        });
      }
      const responseText = req.response?.map((r) => r.value).filter(Boolean).join("\n");
      if (responseText) {
        turns.push({
          turnId: `${sessionId}-assistant-${i}`,
          role: "assistant",
          timestamp: data.lastMessageDate ?? Date.now(),
          text: responseText,
          toolCalls: [],
        });
      }
    }
    if (turns.length === 0) return undefined;
    const st = statSync(filePath);
    return { turns, lastModified: st.mtimeMs };
  } catch {
    return undefined;
  }
}

function scanChatSessions(storageRoot: string, since?: number): CopilotSession[] {
  const results: CopilotSession[] = [];
  const wsDir = join(storageRoot, "workspaceStorage");
  if (!existsSync(wsDir)) return results;

  for (const hash of readdirSync(wsDir)) {
    const chatDir = join(wsDir, hash, "chatSessions");
    if (!existsSync(chatDir)) continue;
    const projectPath = resolveProjectPath(hash, storageRoot);
    for (const file of readdirSync(chatDir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(chatDir, file);
      const sessionId = file.replace(/\.json$/, "");
      const raw = readFileSync(filePath, "utf-8");
      const parsed = parseChatSessionJson(raw, sessionId, projectPath, filePath);
      if (!parsed) continue;
      if (since && parsed.lastModified < since) continue;
      results.push({
        sessionId,
        projectPath,
        lastModified: parsed.lastModified,
        transcriptPath: filePath,
        turns: parsed.turns,
      });
    }
  }
  return results;
}

function scanVscdbFallback(storageRoot: string, since?: number): CopilotSession[] {
  const results = scanChatSessions(storageRoot, since);
  const globalDb = join(storageRoot, "globalStorage", "state.vscdb");
  if (!existsSync(globalDb)) return results;

  const db = new DatabaseSync(globalDb, { readOnly: true });
  for (const key of ["interactive.sessions", "memento/interactive-session"]) {
    try {
      const row = db.prepare(`SELECT value FROM ItemTable WHERE key = $key`).get({ key }) as
        | { value: string | Buffer }
        | undefined;
      if (!row || row.value == null) continue;
      const raw = typeof row.value === "string" ? row.value : row.value.toString("utf-8");
      const parsed = parseChatSessionJson(raw, `vscdb-${key}`, "global", globalDb);
      if (parsed && (!since || parsed.lastModified >= since)) {
        results.push({
          sessionId: `vscdb-${key}`,
          projectPath: "global",
          lastModified: parsed.lastModified,
          transcriptPath: globalDb,
          turns: parsed.turns,
        });
      }
    } catch {
      // skip
    }
  }
  return results;
}

export function parseWorkspaceYaml(raw: string): { projectPath?: string; sessionId?: string } {
  const lines = raw.split("\n");
  let gitRoot: string | undefined;
  let cwd: string | undefined;
  let id: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("git_root:")) {
      gitRoot = trimmed.slice("git_root:".length).trim();
    } else if (trimmed.startsWith("cwd:")) {
      cwd = trimmed.slice("cwd:".length).trim();
    } else if (trimmed.startsWith("id:")) {
      id = trimmed.slice("id:".length).trim();
    }
  }
  const projectPath = gitRoot || cwd;
  return { projectPath, sessionId: id };
}

export function parseCopilotEventsJsonl(
  raw: string,
  sessionId: string,
  projectPath: string,
  transcriptPath: string,
  fileMtimeMs: number,
): CopilotSession | undefined {
  const turns: Turn[] = [];
  let turnIndex = 0;
  let latestTs = fileMtimeMs;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: {
      type?: string;
      timestamp?: string;
      data?: {
        content?: string;
        transformedContent?: string;
        message?: string;
        text?: string;
      };
    };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.timestamp) {
      const ts = Date.parse(event.timestamp);
      if (!Number.isNaN(ts)) latestTs = Math.max(latestTs, ts);
    }

    if (event.type === "user.message") {
      const text = event.data?.content ?? event.data?.transformedContent;
      if (text) {
        turns.push({
          turnId: `${sessionId}-user-${turnIndex}`,
          role: "user",
          timestamp: event.timestamp ? Date.parse(event.timestamp) : fileMtimeMs,
          text,
          toolCalls: [],
        });
        turnIndex++;
      }
      continue;
    }

    if (event.type?.startsWith("assistant.")) {
      const text = event.data?.content ?? event.data?.message ?? event.data?.text;
      if (text && typeof text === "string") {
        turns.push({
          turnId: `${sessionId}-assistant-${turnIndex}`,
          role: "assistant",
          timestamp: event.timestamp ? Date.parse(event.timestamp) : fileMtimeMs,
          text,
          toolCalls: [],
        });
        turnIndex++;
      }
    }
  }

  if (turns.length === 0) return undefined;
  return {
    sessionId,
    projectPath,
    lastModified: latestTs,
    transcriptPath,
    turns,
  };
}

export function scanCopilotSessionState(stateRoot: string, since?: number): CopilotSession[] {
  const results: CopilotSession[] = [];
  if (!existsSync(stateRoot)) return results;

  let sessionDirs: string[];
  try {
    sessionDirs = readdirSync(stateRoot);
  } catch {
    return results;
  }

  for (const sessionId of sessionDirs) {
    const sessionDir = join(stateRoot, sessionId);
    const eventsPath = join(sessionDir, "events.jsonl");
    if (!existsSync(eventsPath)) continue;

    let projectPath = sessionId;
    const workspaceYaml = join(sessionDir, "workspace.yaml");
    if (existsSync(workspaceYaml)) {
      try {
        const yaml = parseWorkspaceYaml(readFileSync(workspaceYaml, "utf-8"));
        if (yaml.projectPath) projectPath = yaml.projectPath;
      } catch {
        // keep default
      }
    }

    let raw: string;
    let fileMtimeMs: number;
    try {
      raw = readFileSync(eventsPath, "utf-8");
      fileMtimeMs = statSync(eventsPath).mtimeMs;
    } catch {
      continue;
    }

    const session = parseCopilotEventsJsonl(raw, sessionId, projectPath, eventsPath, fileMtimeMs);
    if (!session) continue;
    if (since && session.lastModified < since) continue;
    results.push(session);
  }
  return results;
}

function collectAllSessions(since?: number): CopilotSession[] {
  return [
    ...scanVscdbFallback(copilotStorageRoot(), since),
    ...scanCopilotSessionState(copilotSessionStateDir(), since),
  ];
}

export class CopilotAdapter implements SessionAdapter {
  readonly id = "copilot";

  isAvailable(): boolean {
    const root = copilotStorageRoot();
    return (
      existsSync(root) ||
      existsSync(join(homedir(), ".copilot", "session-store.db")) ||
      existsSync(copilotSessionStateDir())
    );
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
      throw new Error(`CopilotAdapter.loadSession: session ${ref.sessionId} not found`);
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
