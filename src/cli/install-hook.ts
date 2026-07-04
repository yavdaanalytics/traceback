#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at dist/cli/install-hook.js at runtime; dist/ is the
// package root for git-invoked calls (node dist/cli/hook-entry.js).
const distDir = dirname(__dirname);

export function installHook(targetRepoPath: string): void {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: targetRepoPath,
    encoding: "utf-8",
  }).trim();

  // `git rev-parse --git-path hooks` resolves the *effective* hooks
  // directory, honoring a repo-local or global `core.hooksPath` override.
  // Hardcoding `.git/hooks` is wrong whenever that's set (common on
  // machines with their own commit-safety tooling, not just this one) -
  // the hook would be written somewhere git never looks. The result can be
  // either absolute (a hooksPath override) or relative to repoRoot (the
  // default `.git/hooks`).
  const gitPathHooks = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
    cwd: repoRoot,
    encoding: "utf-8",
  }).trim();
  const hooksDir = isAbsolute(gitPathHooks) ? gitPathHooks : join(repoRoot, gitPathHooks);
  const defaultHooksDir = join(repoRoot, ".git", "hooks");

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const templatePath = join(distDir, "..", "scripts", "post-commit.sh");
  const template = readFileSync(templatePath, "utf-8").replace(
    "__TRACEBACK_DIST_DIR__",
    distDir.replace(/\\/g, "/"),
  );

  const hookPath = join(hooksDir, "post-commit");
  writeFileSync(hookPath, template, { mode: 0o755 });
  chmodSync(hookPath, 0o755);

  console.log(`traceback: installed post-commit hook at ${hookPath}`);

  if (hooksDir !== defaultHooksDir) {
    console.warn(
      `traceback: warning - this repo (or a global git config) sets core.hooksPath to ${hooksDir}, ` +
        `not the repo-local .git/hooks. If that path is shared across multiple repositories, this hook ` +
        `will run for commits in ALL of them (scoped correctly at runtime via each commit's own repo root), ` +
        `not just this one.`,
    );
  }
}

// Guarded so setup.ts can import installHook() directly without re-running it
// as a side effect of the import.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const targetRepoPath = process.argv[2] ?? process.cwd();
  installHook(targetRepoPath);
}
