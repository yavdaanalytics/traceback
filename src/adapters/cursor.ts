import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ParsedSession, SessionAdapter, SessionRef } from "./types.js";

// UNVERIFIED SCHEMA: community reverse-engineering (not confirmed against a live
// Cursor install) places chat/composer history in the Cursor desktop app's
// state.vscdb (SQLite) under workspaceStorage, keyed by
// "workbench.panel.aichat.view.aichat.chatdata" / "composer.composerData" in an
// ItemTable, plus a global state.vscdb under globalStorage. Confirm against a
// real installation before trusting anything beyond isAvailable().
const CURSOR_STORAGE_DIR =
  process.platform === "win32"
    ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Cursor", "User")
    : join(homedir(), ".config", "Cursor", "User");

export class CursorAdapter implements SessionAdapter {
  readonly id = "cursor";

  isAvailable(): boolean {
    return existsSync(CURSOR_STORAGE_DIR);
  }

  listSessions(_since?: number): SessionRef[] {
    // Stub: schema unverified, return empty rather than guessing at a SQLite
    // query that may not match the real ItemTable structure.
    return [];
  }

  loadSession(_ref: SessionRef): ParsedSession {
    throw new Error(
      "CursorAdapter.loadSession: not implemented (schema unverified, see PROMPT.md)",
    );
  }
}
