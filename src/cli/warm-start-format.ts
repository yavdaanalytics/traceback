import type { FallbackResult } from "../mcp/fallback.js";

const MAX_GREP_LINES = 40;
const MAX_SESSIONS = 5;
const MAX_COMMITS = 5;

export function formatWarmStartContext(result: FallbackResult): string {
  const lines: string[] = ["## traceback warm-start context", `mode: ${result.mode}`];

  if (result.session_matches?.length) {
    lines.push("", "### similar past sessions");
    for (const s of result.session_matches.slice(0, MAX_SESSIONS)) {
      lines.push(`- session_id=${s.session_id} distance=${s._distance.toFixed(3)}`);
    }
  }

  if (result.git_scope?.length) {
    lines.push("", "### git history scope");
    for (const c of result.git_scope.slice(0, MAX_COMMITS)) {
      const files = c.files_changed.slice(0, 8).join(", ");
      const more = c.files_changed.length > 8 ? ` (+${c.files_changed.length - 8} more)` : "";
      lines.push(`- ${c.commit_hash.slice(0, 12)}: ${files}${more}`);
    }
  }

  const grepLines = result.grep_result.split("\n").filter(Boolean);
  if (grepLines.length > 0) {
    lines.push("", "### scoped grep hits");
    for (const line of grepLines.slice(0, MAX_GREP_LINES)) {
      lines.push(line);
    }
    if (grepLines.length > MAX_GREP_LINES) {
      lines.push(`... (${grepLines.length - MAX_GREP_LINES} more lines)`);
    }
  }

  if (result.refinements?.ast?.trim()) {
    lines.push("", "### ast symbol search", result.refinements.ast.trim().slice(0, 2000));
  }
  if (result.refinements?.keyword?.trim()) {
    lines.push("", "### keyword search", result.refinements.keyword.trim().slice(0, 2000));
  }

  if (result.layers.length > 0) {
    lines.push("", "### layers");
    for (const layer of result.layers) {
      lines.push(`- L${layer.layer} ${layer.tool} (${layer.mode})`);
    }
  }

  return lines.join("\n");
}

export function wrapVsCodeResponse(hookEventName: string, context: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: context,
    },
  });
}

export function wrapCursorReadResponse(context: string): string {
  return JSON.stringify({ additional_context: context });
}

export type WarmStartFormat =
  | "vscode"
  | "cursor-read"
  | "cursor-gate"
  | "cursor-mcp-mark"
  | "windsurf"
  | "plain";

export interface HookStdin {
  hook_event_name?: string;
  prompt?: string;
  conversation_id?: string;
  generation_id?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; [key: string]: unknown };
  file_path?: string;
  tool_info?: { user_prompt?: string };
}

export function extractQueryFromStdin(format: WarmStartFormat, stdin: HookStdin, cliQuery?: string): string {
  if (cliQuery?.trim()) return cliQuery.trim();

  if (format === "cursor-read") {
    const path = stdin.file_path ?? stdin.tool_input?.file_path;
    if (typeof path === "string" && path.trim()) return path.trim();
    return "";
  }

  if (format === "windsurf") {
    const prompt = stdin.tool_info?.user_prompt;
    if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
    return typeof stdin.prompt === "string" ? stdin.prompt.trim() : "";
  }

  if (format === "vscode") {
    const event = stdin.hook_event_name ?? "";
    if (/pretooluse/i.test(event)) {
      const path = stdin.tool_input?.file_path;
      if (typeof path === "string" && path.trim()) return path.trim();
    }
    if (typeof stdin.prompt === "string" && stdin.prompt.trim()) return stdin.prompt.trim();
    return "";
  }

  return typeof stdin.prompt === "string" ? stdin.prompt.trim() : "";
}

export function normalizeVsCodeHookEventName(raw?: string): string {
  if (!raw) return "UserPromptSubmit";
  if (/pretooluse/i.test(raw)) return "PreToolUse";
  if (/userpromptsubmit/i.test(raw)) return "UserPromptSubmit";
  return raw;
}
