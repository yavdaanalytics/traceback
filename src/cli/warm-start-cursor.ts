import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CursorHookStdin {
  conversation_id?: string;
  generation_id?: string;
  tool_name?: string;
}

export function warmMarkerPath(repoPath: string, generationId: string): string {
  return join(repoPath, ".traceback", "warm-markers", `${generationId}.marker`);
}

export function warmGenerationId(stdin: CursorHookStdin): string | null {
  const id = stdin.generation_id ?? stdin.conversation_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function isWarmStarted(repoPath: string, generationId: string): boolean {
  return existsSync(warmMarkerPath(repoPath, generationId));
}

export function markWarmStarted(repoPath: string, generationId: string): void {
  const path = warmMarkerPath(repoPath, generationId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Date().toISOString(), "utf-8");
}

export function isTracebackSearchTool(toolName: string): boolean {
  return /search_with_fallback/i.test(toolName);
}

export function isBlockedPreTool(toolName: string): boolean {
  return /^(Grep|Glob)$/i.test(toolName.trim());
}

export function runCursorWarmGate(opts: {
  repoPath: string;
  stdin: CursorHookStdin;
  callServerId: string;
}): string {
  const generationId = warmGenerationId(opts.stdin);
  const toolName = opts.stdin.tool_name ?? "";
  if (!generationId || !isBlockedPreTool(toolName)) {
    return JSON.stringify({ permission: "allow" });
  }
  if (isWarmStarted(opts.repoPath, generationId)) {
    return JSON.stringify({ permission: "allow" });
  }

  const repo = opts.repoPath.replace(/\\/g, "/");
  return JSON.stringify({
    permission: "deny",
    agent_message:
      `Traceback warm-start required: call MCP tool search_with_fallback on server "${opts.callServerId}" ` +
      `with query set to the user's message and repo_path="${repo}" BEFORE using ${toolName}. ` +
      "This is mandatory per .cursor/rules/traceback.mdc. Use the returned grep_result and git_scope to scope follow-up reads.",
    user_message: "Blocked until traceback search_with_fallback runs for this turn.",
  });
}

export function runCursorMcpMark(opts: { repoPath: string; stdin: CursorHookStdin }): string {
  const generationId = warmGenerationId(opts.stdin);
  const toolName = opts.stdin.tool_name ?? "";
  if (generationId && isTracebackSearchTool(toolName)) {
    markWarmStarted(opts.repoPath, generationId);
  }
  return "{}";
}
