// Normalizes a filesystem path for comparison across sources that use
// different separators/casing (Claude Code's desanitized project dir uses
// forward slashes; repo paths passed around the process may use OS-native
// separators, and Windows paths are case-insensitive).
export function normalizePath(p: string): string {
  let norm = p.replace(/\\/g, "/").toLowerCase();
  // Cursor/VS Code workspace.json uses file:///c:/... which decodes to /c:/...
  if (/^\/[a-z]:\//.test(norm)) {
    norm = norm.slice(1);
  }
  return norm;
}
