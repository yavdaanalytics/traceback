import { existsSync } from "node:fs";
import { join } from "node:path";

export type CommandMode = "portable" | "dev";

export function resolveCommandMode(packageDistDir: string): CommandMode {
  const env = process.env.TRACEBACK_DEV?.trim() || process.env.TRACE_BACK_DEV?.trim();
  if (env === "1" || env === "true" || env === "yes") return "dev";
  const pkgRoot = join(packageDistDir, "..");
  if (existsSync(join(pkgRoot, "src", "cli", "setup.ts"))) return "dev";
  return "portable";
}

export function mcpServerEntryDev(serverEntryPath: string): { command: string; args: string[] } {
  return { command: "node", args: [serverEntryPath] };
}

export function mcpServerEntryPortable(): { command: string; args: string[] } {
  return { command: "npx", args: ["-y", "traceback"] };
}

export function warmStartCommandDev(
  scriptPath: string,
  format: string,
  repoRoot?: string,
): string {
  const parts = [`node "${scriptPath}"`, `--format ${format}`];
  if (repoRoot) parts.push(`--repo-path "${repoRoot.replace(/\\/g, "/")}"`);
  return parts.join(" ");
}

export function warmStartCommandPortable(format: string, repoRoot?: string): string {
  const parts = ["traceback-warmstart", `--format ${format}`];
  if (repoRoot) parts.push(`--repo-path "${repoRoot.replace(/\\/g, "/")}"`);
  return parts.join(" ");
}

export function hookEntryCommandDev(scriptPath: string, repoRoot: string): string {
  return `node "${scriptPath}" "${repoRoot.replace(/\\/g, "/")}"`;
}

export function hookEntryCommandPortable(repoRoot: string): string {
  return `traceback-hook-entry "${repoRoot.replace(/\\/g, "/")}"`;
}
