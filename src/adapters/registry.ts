import { ClaudeCodeAdapter } from "./claude-code.js";
import { CopilotAdapter } from "./copilot.js";
import { CursorAdapter } from "./cursor.js";
import type { SessionAdapter } from "./types.js";

const adapters: SessionAdapter[] = [new ClaudeCodeAdapter(), new CursorAdapter(), new CopilotAdapter()];

export function listAdapters(): SessionAdapter[] {
  return adapters;
}

export function getAdapter(id: string): SessionAdapter | undefined {
  return adapters.find((a) => a.id === id);
}

export function availableAdapters(): SessionAdapter[] {
  return adapters.filter((a) => a.isAvailable());
}
