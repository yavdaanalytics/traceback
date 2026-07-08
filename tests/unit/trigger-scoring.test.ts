import { describe, expect, it } from "vitest";
import { scoreQueryForTrigger, triggerTermsCount } from "../../src/mcp/trigger-scoring.js";

describe("trigger scoring", () => {
  it("labels strong traceback/debug prompts as strong", () => {
    const score = scoreQueryForTrigger("why is this regression bug happening in session history", {
      strongThreshold: 2.2,
      weakThreshold: 0.8,
    });
    expect(score.decision).toBe("strong");
    expect(triggerTermsCount(score)).toBeGreaterThan(0);
  });

  it("labels generic question words as weak instead of strong", () => {
    const score = scoreQueryForTrigger("why and how", {
      strongThreshold: 2.2,
      weakThreshold: 0.3,
    });
    expect(score.decision).toBe("weak");
  });

  it("labels non-code prompts as skip with negatives", () => {
    const score = scoreQueryForTrigger("what is the weather forecast today", {
      strongThreshold: 2.2,
      weakThreshold: 0.8,
    });
    expect(score.decision).toBe("skip");
  });
});

