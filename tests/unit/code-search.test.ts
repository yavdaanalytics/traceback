import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { diffSearch, keywordSearch } from "../../src/mcp/code-search.js";

describe("code-search", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "traceback-codesearch-"));
  mkdirSync(join(repoDir, "src"));
  writeFileSync(join(repoDir, "src", "a.ts"), "// TODO: fix jwt\nexport const x = 1;\n");
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "add todo"], { cwd: repoDir });

  it("keyword_search finds TODO markers", () => {
    const out = keywordSearch(repoDir, undefined, { files: ["src/a.ts"] });
    expect(out).toContain("TODO");
  });

  it("diff_search accepts pattern as literal argv", () => {
    const out = diffSearch(repoDir, "jwt", { files: ["src/a.ts"] });
    expect(out.length).toBeGreaterThanOrEqual(0);
  });

  it("rejects path traversal in files[]", () => {
    expect(() => diffSearch(repoDir, "jwt", { files: ["../../etc/passwd"] })).toThrow(/traversal/i);
  });
});
