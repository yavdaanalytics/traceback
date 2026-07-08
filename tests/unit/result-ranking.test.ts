import { describe, expect, it } from "vitest";
import { rankGrepHits } from "../../src/mcp/result-ranking.js";

describe("result ranking", () => {
  it("boosts src hits and dedupes per file", () => {
    const ranked = rankGrepHits(
      [
        { file: "README.md", line: 1, content: "warm-start" },
        { file: "src/fallback.ts", line: 10, content: "const x = 1;" },
        { file: "src/fallback.ts", line: 11, content: "const y = 1;" },
        { file: "src/fallback.ts", line: 12, content: "const z = 1;" },
        { file: "src/fallback.ts", line: 13, content: "const w = 1;" },
      ],
      { maxPerFile: 3 },
    );
    expect(ranked[0].file).toBe("src/fallback.ts");
    expect(ranked.filter((h) => h.file === "src/fallback.ts")).toHaveLength(3);
  });
});

