import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { embedText } from "../../src/embedding/embedder.js";
import { upsertTurnEmbeddings, searchSimilarTurns, type TurnEmbeddingRow } from "../../src/storage/lancedb.js";
import { computeGrepBaseline } from "../../src/mcp/telemetry.js";
import { searchGrep } from "../../src/mcp/search.js";

// Scripted, deterministic evals of the agent-facing contract traceback
// promises: (1) recall quality - does find_similar_sessions actually surface
// the right session for a realistic query, not just "some" result;
// (2) funnel efficiency - does the warm-start path actually pull
// dramatically fewer lines than an unscoped grep, on a repo big enough to be
// representative; (3) the HITL usage-contract text the calling agent depends
// on is still present verbatim. No LLM call, no API key, fully deterministic.

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-evals-"));
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("eval: recall quality (golden set, recall@1)", () => {
  const goldenSet = [
    { session: "sess-auth", text: "Debugged an OAuth token refresh loop that kept logging users out" },
    { session: "sess-db", text: "Root-caused a Postgres connection pool exhaustion under load" },
    { session: "sess-ui", text: "Fixed a CSS flexbox layout bug causing the sidebar to overlap content" },
    { session: "sess-build", text: "Resolved a Webpack code-splitting issue causing duplicate chunks" },
    { session: "sess-test", text: "Flaky Playwright test failing due to an unawaited async navigation" },
  ];
  const queries = [
    { query: "why do users keep getting logged out after their OAuth token should refresh", expected: "sess-auth" },
    { query: "database connections are exhausted and requests are timing out under load", expected: "sess-db" },
    { query: "sidebar is overlapping the main content because of a flexbox bug", expected: "sess-ui" },
    { query: "webpack is producing duplicate javascript chunks from code splitting", expected: "sess-build" },
    { query: "an e2e test is flaky because a navigation isn't awaited", expected: "sess-test" },
  ];

  let dataDir: string;

  beforeAll(async () => {
    dataDir = join(tmpDir, "eval-lancedb");
    const rows: TurnEmbeddingRow[] = await Promise.all(
      goldenSet.map(async (g, i) => ({
        id: `${g.session}:turn-${i}`,
        session_id: g.session,
        adapter_id: "claude-code",
        turn_id: `turn-${i}`,
        chunk_text: g.text,
        vector: await embedText(g.text),
        project_path: "/eval-repo",
        timestamp: Date.now(),
        kind: "embedding_text" as const,
      })),
    );
    await upsertTurnEmbeddings(dataDir, rows);
  }, 60_000);

  it("achieves 100% recall@1 on the golden query set (5/5 known past-session queries)", async () => {
    let correct = 0;
    for (const q of queries) {
      const vector = await embedText(q.query);
      const [top] = await searchSimilarTurns(dataDir, vector, 1);
      if (top?.session_id === q.expected) correct += 1;
    }
    // A regression below 100% here on this small, deliberately unambiguous
    // golden set means recall quality genuinely degraded (embedding model
    // swap, distance metric change, etc.) - not noise.
    expect(correct).toBe(queries.length);
  }, 30_000);
});

describe("eval: warm-start funnel efficiency vs unscoped grep", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = join(tmpDir, "eval-repo");
    mkdirSync(repoDir);
    execFileSync("git", ["init", "-q"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });

    // One file with the target pattern (the "narrowed scope" a semantic hit
    // would point at), plus 200 unrelated noise files each also containing
    // the pattern once - simulating a repo where a blind grep returns a
    // wall of irrelevant hits.
    mkdirSync(join(repoDir, "src"));
    writeFileSync(join(repoDir, "src", "target.ts"), "function refreshToken() {}\n".repeat(3));
    for (let i = 0; i < 200; i++) {
      writeFileSync(join(repoDir, `noise${i}.ts`), `// unrelated file ${i}\nfunction refreshToken() {}\n`);
    }
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: repoDir });
  });

  it("scoping to the narrowed file cuts >=95% of the lines an unscoped grep would return", () => {
    const baseline = computeGrepBaseline(repoDir, "refreshToken");
    const scoped = searchGrep(repoDir, "refreshToken", ["src/target.ts"]);
    const scopedLines = scoped.split("\n").filter(Boolean).length;

    expect(baseline).toBeGreaterThan(scopedLines * 5); // sanity: fixture is actually noisy
    const reductionPct = (100 * (baseline - scopedLines)) / baseline;
    expect(reductionPct).toBeGreaterThanOrEqual(95);
  });
});

describe("eval: Cursor warm-start rule contract is intact", () => {
  it("renderTracebackCursorRule pins mandatory first-tool-call language", async () => {
    const { renderTracebackCursorRule } = await import("../../src/cli/setup.js");
    const rule = renderTracebackCursorRule("user-traceback");
    expect(rule).toContain("MANDATORY");
    expect(rule).toContain("tool invocation in that turn MUST be");
    expect(rule).toContain("search_with_fallback");
    expect(rule).toContain("preToolUse");
    expect(rule).toContain("user-traceback");
  });
});

describe("eval: HITL usage-contract text is intact", () => {
  it("submit_feedback's tool description still instructs the calling agent to get explicit user approval first", () => {
    const source = readFileSync(join(process.cwd(), "src", "mcp", "index.ts"), "utf-8");
    const registration = source.slice(source.indexOf('"submit_feedback"'), source.indexOf('"submit_feedback"') + 1200);
    expect(registration).toContain("no separate propose-plan step");
    expect(registration).toContain("get an explicit yes/no");
    expect(registration).toContain("ONLY THEN call this tool");
  });
});

describe("eval: meta.certainty on search tools", () => {
  it("labels module defines probabilistic and deterministic", async () => {
    const { sourceCertainty } = await import("../../src/mcp/labels.js");
    expect(sourceCertainty("session_vector")).toBe("probabilistic");
    expect(sourceCertainty("grep_scoped")).toBe("deterministic");
  });
});
