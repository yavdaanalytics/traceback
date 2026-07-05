import type { ParsedSession, Turn } from "../adapters/types.js";

function digestToolCall(tc: Turn["toolCalls"][number]): string {
  if (tc.isFileEdit && tc.filePath) return `Edited ${tc.filePath}`;
  if (tc.isShellCommand && tc.command) return `Ran: ${tc.command}`;
  if (tc.toolName === "Read" && typeof tc.input === "object" && tc.input && "file_path" in tc.input) {
    return `Read ${(tc.input as Record<string, unknown>).file_path}`;
  }
  return `Used ${tc.toolName}`;
}

// Purely extractive/templated - no LLM call, keeps the embedding pipeline fully
// local and free. Full tool inputs/outputs are deliberately excluded: they are
// mostly noise for semantic recall and would bloat any downstream tool result.
export function digestTurn(turn: Turn): string {
  const parts: string[] = [];
  if (turn.text) parts.push(turn.text);
  for (const tc of turn.toolCalls) parts.push(digestToolCall(tc));
  return parts.join("\n");
}

export function digestSession(session: ParsedSession): string {
  const userPrompts = session.turns
    .filter((t) => t.role === "user" && t.text)
    .map((t) => t.text as string);
  const toolDigests = session.turns.flatMap((t) => t.toolCalls.map(digestToolCall));
  return [...userPrompts, ...toolDigests].join("\n");
}

// Extract intent from first user turn (the initial question/goal)
// Truncated to ~100 chars for readability in UI/reports
export function extractIntent(session: ParsedSession): string | null {
  const firstUserTurn = session.turns.find((t) => t.role === "user" && t.text);
  if (!firstUserTurn?.text) return null;

  // Truncate to first sentence or 100 chars, whichever is shorter
  const text = firstUserTurn.text.trim();
  const firstSentence = text.split(/[.!?]+/)[0];
  const intent = firstSentence.substring(0, 100);
  return intent.length > 0 ? intent : null;
}
