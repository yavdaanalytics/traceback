// Normalizes a filesystem path for comparison across sources that use
// different separators/casing (Claude Code's desanitized project dir uses
// forward slashes; repo paths passed around the process may use OS-native
// separators, and Windows paths are case-insensitive).
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}
