export interface SessionRef {
  adapterId: string;
  sessionId: string;
  projectPath: string;
  lastModified: number;
  sizeHint: number;
  /** Optional absolute path to raw transcript (Claude .jsonl, etc.) */
  transcriptPath?: string;
}

export interface ToolCall {
  toolName: string;
  input: unknown;
  isFileEdit: boolean;
  filePath?: string;
  isShellCommand: boolean;
  command?: string;
}

export interface Turn {
  turnId: string;
  parentTurnId?: string;
  role: "user" | "assistant";
  timestamp: number;
  text?: string;
  toolCalls: ToolCall[];
}

export interface ParsedSession {
  sessionId: string;
  adapterId: string;
  projectPath: string;
  gitBranch?: string;
  startedAt: number;
  endedAt: number;
  slug?: string;
  turns: Turn[];
}

export interface NormalizedSession extends ParsedSession {
  transcriptRef: string;
  segmentIndex: number;
  sourceFileKey: string;
  metadata?: { todos?: unknown[]; history?: unknown[] };
}

export interface SessionAdapter {
  id: string;
  isAvailable(): boolean;
  discover(since?: number): SessionRef[];
  parse(ref: SessionRef): NormalizedSession;
  /** @deprecated use discover */
  listSessions(since?: number): SessionRef[];
  /** @deprecated use parse */
  loadSession(ref: SessionRef): NormalizedSession;
}
