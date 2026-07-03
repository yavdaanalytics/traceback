export interface SessionRef {
  adapterId: string;
  sessionId: string;
  projectPath: string;
  lastModified: number;
  sizeHint: number;
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

export interface SessionAdapter {
  id: string;
  isAvailable(): boolean;
  listSessions(since?: number): SessionRef[];
  loadSession(ref: SessionRef): ParsedSession;
}
