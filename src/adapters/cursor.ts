import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NormalizedSession, SessionAdapter, SessionRef, Turn } from "./types.js";

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
    if (!row) return undefined;
    return typeof row.value === "string" ? row.value : row.value.toString("utf-8");
  } catch {
    return undefined;
  }
}

function readCursorDiskKv(dbPath: string, key: string): string | undefined {
  if (!existsSync(dbPath)) return undefined;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT value FROM cursorDiskKV WHERE key = $key`).get({ key }) as
      | { value: string | Buffer }
      | undefined;
    if (!row) return undefined;
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

interface ComposerSession {
  composerId: string;
  projectPath: string;
  lastModified: number;
  transcriptPath: string;
  turns: Turn[];
}

function parseComposerData(raw: string, composerId: string, projectPath: string, transcriptPath: string): ComposerSession | undefined {
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
    return { composerId, projectPath, lastModified, transcriptPath, turns };
  } catch {
    return undefined;
  }
}

function scanWorkspaceStorage(storageRoot: string, since?: number): ComposerSession[] {
  const results: ComposerSession[] = [];
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

function scanGlobalStorage(storageRoot: string, since?: number): ComposerSession[] {
  const results: ComposerSession[] = [];
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

export class CursorAdapter implements SessionAdapter {
  readonly id = "cursor";

  isAvailable(): boolean {
    return existsSync(cursorStorageRoot());
  }

  discover(since?: number): SessionRef[] {
    return this.listSessions(since);
  }

  parse(ref: SessionRef): NormalizedSession {
    return this.loadSession(ref);
  }

  listSessions(since?: number): SessionRef[] {
    if (!this.isAvailable()) return [];
    const storageRoot = cursorStorageRoot();
    const byId = new Map<string, SessionRef>();

    for (const session of [...scanWorkspaceStorage(storageRoot, since), ...scanGlobalStorage(storageRoot, since)]) {
      const existing = byId.get(session.composerId);
      if (!existing || session.lastModified > existing.lastModified) {
        byId.set(session.composerId, {
          adapterId: this.id,
          sessionId: session.composerId,
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
    const storageRoot = cursorStorageRoot();
    const all = [...scanWorkspaceStorage(storageRoot), ...scanGlobalStorage(storageRoot)];
    const match = all.find((s) => s.composerId === ref.sessionId);
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
