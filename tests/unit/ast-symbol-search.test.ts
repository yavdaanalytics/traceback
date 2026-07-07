import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { astSymbolSearch } from "../../src/ast/symbol-search.js";

describe("ast_symbol_search", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "traceback-ast-"));
  const dataDir = join(repoDir, "lancedb");
  mkdirSync(join(repoDir, "src"));
  writeFileSync(join(repoDir, "src", "auth.ts"), "export function refreshToken() { return 1; }\n");

  it("finds function definition in scoped file", async () => {
    const out = await astSymbolSearch(repoDir, dataDir, "refreshToken", { files: ["src/auth.ts"] });
    expect(out).toContain("refreshToken");
  });
});
