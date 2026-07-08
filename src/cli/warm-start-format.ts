import type { FallbackResult } from "../mcp/fallback.js";
import { summarizeFallbackForAgent } from "../mcp/payload-formatter.js";

const MAX_GREP_LINES = 40;
const MAX_SESSIONS = 5;
const MAX_COMMITS = 5;

export function formatWarmStartContext(result: FallbackResult): string {
  const summary = summarizeFallbackForAgent(result, { maxGrepLines: MAX_GREP_LINES, omitEmptyRefinements: true });
  const lines: string[] = ["## traceback warm-start context", `mode: ${String(summary.mode)}`];

  const intentSummary = summary.intent_summary as
    | { sessions?: Array<{ session_id: string; distance: number; outcome?: string | null }> }
    | undefined;
  if (intentSummary?.sessions?.length) {
    lines.push("", "### similar past sessions");
    for (const s of intentSummary.sessions.slice(0, MAX_SESSIONS)) {
      const outcome = s.outcome ? ` outcome=${s.outcome}` : "";
      lines.push(`- session_id=${s.session_id} distance=${s.distance.toFixed(3)}${outcome}`);
    }
  } else if (result.session_matches?.length) {
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

  const grepRows = (summary.grep_results as Array<{ file: string; line: number; snippet: string }> | undefined) ?? [];
  if (grepRows.length > 0) {
    lines.push("", "### scoped grep hits");
    for (const row of grepRows) {
      lines.push(`${row.file}:${row.line}:${row.snippet}`);
    }
    const grepSummary = summary.grep_summary as { total_hits?: number } | undefined;
    const total = grepSummary?.total_hits ?? grepRows.length;
    if (total > grepRows.length) {
      lines.push(`... (${total - grepRows.length} more lines)`);
    }
  }

  const ast = summary.ast_refinements;
  if (typeof ast === "string" && ast.trim()) {
    lines.push("", "### ast symbol search", ast.trim().slice(0, 2000));
  }
  const keyword = summary.keyword_refinements;
  if (typeof keyword === "string" && keyword.trim()) {
    lines.push("", "### keyword search", keyword.trim().slice(0, 2000));
  }

  if (result.layers.length > 0) {
    lines.push("", "### layers");
    for (const layer of result.layers) {
      lines.push(`- L${layer.layer} ${layer.tool} (${layer.mode})`);
    }
  }

  const patterns = summary.relevant_patterns as Array<{ title: string; guidance: string }> | undefined;
  if (patterns?.length) {
    lines.push("", "### relevant patterns");
    for (const pattern of patterns.slice(0, 3)) {
      lines.push(`- ${pattern.title}: ${pattern.guidance}`);
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
