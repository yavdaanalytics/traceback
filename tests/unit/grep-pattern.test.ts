import { describe, expect, it } from "vitest";
import { defaultGrepExcludes, deriveGrepPattern } from "../../src/mcp/grep-pattern.js";

describe("grep pattern derivation", () => {
  it("drops generic words but keeps identifiers", () => {
    const derived = deriveGrepPattern("is warm-start grep implemented");
    expect(derived.pattern).toContain("warm-start");
    expect(derived.pattern).not.toContain("(grep)");
    expect(derived.pattern).not.toContain("(is)");
  });

  it("includes docs when docs query is explicit", () => {
    const docs = deriveGrepPattern("show readme docs for setup");
    expect(defaultGrepExcludes(docs.includeDocs)).toEqual([]);
  });
});

