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
