import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TRACEBACK_CLAUDE_MD_MARKER_END,
  TRACEBACK_CLAUDE_MD_MARKER_START,
  hasClaudeMdOnboarding,
  mergeClaudeMdOnboarding,
  renderClaudeMdOnboardingBlock,
} from "../../src/cli/claude-md-onboarding.js";
import { runSetupDoctor } from "../../src/cli/setup-doctor.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "traceback-claude-md-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("renderClaudeMdOnboardingBlock", () => {
  it("includes workflow tools and markers", () => {
    const block = renderClaudeMdOnboardingBlock();
    expect(block).toContain(TRACEBACK_CLAUDE_MD_MARKER_START);
    expect(block).toContain(TRACEBACK_CLAUDE_MD_MARKER_END);
    expect(block).toContain("search_with_fallback");
    expect(block).toContain("get_traceback_status");
    expect(block).toContain("blame_current");
  });

  it("mentions SETUP.md when hasSetupMd is true", () => {
    const block = renderClaudeMdOnboardingBlock({ hasSetupMd: true });
    expect(block).toContain("SETUP.md");
  });
});

describe("mergeClaudeMdOnboarding", () => {
  it("creates CLAUDE.md when missing", () => {
    const result = mergeClaudeMdOnboarding(repoRoot);
    expect(result.changed).toBe("created");
    expect(existsSync(join(repoRoot, "CLAUDE.md"))).toBe(true);
    const content = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    expect(content).toContain("# CLAUDE.md");
    expect(content).toContain(TRACEBACK_CLAUDE_MD_MARKER_START);
    expect(hasClaudeMdOnboarding(repoRoot)).toBe(true);
  });

  it("is idempotent on second run", () => {
    mergeClaudeMdOnboarding(repoRoot);
    const first = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    const second = mergeClaudeMdOnboarding(repoRoot);
    expect(second.changed).toBe("unchanged");
    expect(readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8")).toBe(first);
  });

  it("preserves content outside the marked block", () => {
    writeFileSync(
      join(repoRoot, "CLAUDE.md"),
      "# My project\n\nCustom notes here.\n",
      "utf-8",
    );
    mergeClaudeMdOnboarding(repoRoot);
    const content = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    expect(content).toContain("Custom notes here.");
    expect(content).toContain(TRACEBACK_CLAUDE_MD_MARKER_START);
  });

  it("replaces an existing marked block on template refresh", () => {
    writeFileSync(
      join(repoRoot, "CLAUDE.md"),
      `# Project\n\n${TRACEBACK_CLAUDE_MD_MARKER_START}\nold content\n${TRACEBACK_CLAUDE_MD_MARKER_END}\n`,
      "utf-8",
    );
    const result = mergeClaudeMdOnboarding(repoRoot);
    expect(result.changed).toBe("updated");
    const content = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    expect(content).not.toContain("old content");
    expect(content).toContain("search_with_fallback");
    expect(content.match(new RegExp(TRACEBACK_CLAUDE_MD_MARKER_START, "g"))?.length).toBe(1);
  });
});

describe("runSetupDoctor CLAUDE.md check", () => {
  it("reports onboarding when marker is present in repo", () => {
    mergeClaudeMdOnboarding(repoRoot);
    const report = runSetupDoctor(repoRoot);
    const check = report.checks.find((c) => c.name === "CLAUDE.md onboarding");
    expect(check?.ok).toBe(true);
  });

  it("fails when CLAUDE.md exists without marker", () => {
    writeFileSync(join(repoRoot, "CLAUDE.md"), "# empty\n", "utf-8");
    const report = runSetupDoctor(repoRoot);
    const check = report.checks.find((c) => c.name === "CLAUDE.md onboarding");
    expect(check?.ok).toBe(false);
  });

  it("skips CLAUDE.md check when no repo root provided", () => {
    const report = runSetupDoctor();
    expect(report.checks.some((c) => c.name === "CLAUDE.md onboarding")).toBe(false);
  });
});
