import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TRACEBACK_CLAUDE_MD_MARKER_START = "<!-- traceback-onboarding -->";
export const TRACEBACK_CLAUDE_MD_MARKER_END = "<!-- /traceback-onboarding -->";
const CLAUDE_MD_FILE = "CLAUDE.md";

export interface ClaudeMdOnboardingOpts {
  pluginInstall?: boolean;
  hasSetupMd?: boolean;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function renderClaudeMdOnboardingBlock(opts?: ClaudeMdOnboardingOpts): string {
  const setupLine = opts?.hasSetupMd
    ? "- See [SETUP.md](SETUP.md) in this repo for full traceback configuration and troubleshooting.\n"
    : "";
  const telemetryLine = opts?.pluginInstall
    ? "- Plugin installs default anonymous telemetry ON; opt out with `traceback-telemetry disable`.\n"
    : "";

  return [
    TRACEBACK_CLAUDE_MD_MARKER_START,
    "## Traceback debugging (auto-installed)",
    "",
    "Use the **traceback** MCP server for semantic recall over past coding-agent sessions and scoped git/grep search.",
    "",
    "### When to use",
    "- Debugging failures, regressions, or \"why does this code exist?\"",
    "- Before repo-wide grep/glob — warm-start narrows scope to relevant files and commits",
    "- Investigating patterns that repeat across sessions (use `submit_feedback` / `promote_pattern`)",
    "",
    "### Host-first routing",
    "- Hosts with the installed traceback `SKILL.md` use balanced routing: strong/weak matches call traceback; skip only clearly non-code prompts.",
    "- **Claude Code** (deferred schema): call `get_traceback_status` first, then `search_with_fallback`.",
    "- **Cursor**: MCP config key is `traceback`; global installs use `user-traceback`. If routing fails, call `get_connection_info`.",
    "",
    "### Debugging workflow",
    "1. `get_traceback_status` (Claude Code) or `get_connection_info` if the server id is unclear",
    "2. `search_with_fallback` with the user's question and this repo's git root as `repo_path`",
    "3. Narrow with `git_history_scope`, `search_sessions_grep`, `get_session_detail`, `blame_current`",
    "4. Use `find_similar_sessions` when the problem resembles a past agent session",
    "5. Record recurring mistakes via `submit_feedback` and `promote_pattern`",
    "",
    "### Verify setup",
    "- Run `traceback-setup --doctor` to check MCP, hooks, and this onboarding block.",
    setupLine + telemetryLine,
    "Re-run `traceback-setup --repo-only` to refresh this section.",
    TRACEBACK_CLAUDE_MD_MARKER_END,
    "",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i + 1] === ""))
    .join("\n");
}

export function renderNewClaudeMd(opts?: ClaudeMdOnboardingOpts): string {
  return `# CLAUDE.md

${renderClaudeMdOnboardingBlock(opts)}`;
}

function replaceMarkedBlock(content: string, block: string): string {
  const start = content.indexOf(TRACEBACK_CLAUDE_MD_MARKER_START);
  const end = content.indexOf(TRACEBACK_CLAUDE_MD_MARKER_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = content.slice(0, start);
    const after = content.slice(end + TRACEBACK_CLAUDE_MD_MARKER_END.length);
    return `${before}${block}${after}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  const trimmed = content.trimEnd();
  const separator = trimmed.length > 0 ? "\n\n" : "";
  return `${trimmed}${separator}${block}`;
}

export function hasClaudeMdOnboarding(repoRoot: string): boolean {
  const path = join(repoRoot, CLAUDE_MD_FILE);
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf-8").includes(TRACEBACK_CLAUDE_MD_MARKER_START);
}

export function mergeClaudeMdOnboarding(
  repoRoot: string,
  opts?: ClaudeMdOnboardingOpts,
): { path: string; changed: "created" | "updated" | "unchanged" } {
  const path = join(repoRoot, CLAUDE_MD_FILE);
  const blockOpts: ClaudeMdOnboardingOpts = {
    ...opts,
    hasSetupMd: opts?.hasSetupMd ?? existsSync(join(repoRoot, "SETUP.md")),
  };
  const block = renderClaudeMdOnboardingBlock(blockOpts);

  if (!existsSync(path)) {
    const content = renderNewClaudeMd(blockOpts);
    writeFileSync(path, content, "utf-8");
    return { path, changed: "created" };
  }

  const existing = readFileSync(path, "utf-8");
  const next = replaceMarkedBlock(existing, block);
  if (normalizeNewlines(existing) === normalizeNewlines(next)) {
    return { path, changed: "unchanged" };
  }
  writeFileSync(path, next, "utf-8");
  return { path, changed: "updated" };
}
