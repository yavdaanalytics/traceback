import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ParsedSession, SessionAdapter, SessionRef } from "./types.js";

// UNVERIFIED SCHEMA. Two candidate sources, likely both needed as separate
// adapters eventually:
//  - Copilot CLI: ~/.copilot/session-store.db (SQLite, WAL mode) - path is real,
//    internal table schema not inspected.
//  - VS Code Copilot Chat extension: workspaceStorage/<hash>/chatSessions/*.json
//    and/or globalStorage/github.copilot-chat/... - documented community
//    knowledge, not verified on a live install.
// Confirm before trusting anything beyond isAvailable().
const COPILOT_CLI_DIR = join(homedir(), ".copilot");

export class CopilotAdapter implements SessionAdapter {
  readonly id = "copilot";

  isAvailable(): boolean {
    return existsSync(join(COPILOT_CLI_DIR, "session-store.db"));
  }

  listSessions(_since?: number): SessionRef[] {
    // Stub: schema unverified, return empty rather than guessing at a SQLite
    // query that may not match the real session-store.db structure.
    return [];
  }

  loadSession(_ref: SessionRef): ParsedSession {
    throw new Error(
      "CopilotAdapter.loadSession: not implemented (schema unverified, see PROMPT.md)",
    );
  }
}
