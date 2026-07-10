#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolveCommandMode } from "./command-paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = dirname(__dirname);

export function renderPostCommitScript(packageDistDir: string = distDir, chainFrom?: string): string {
  const mode = resolveCommandMode(packageDistDir);
  const tracebackBody =
    mode === "dev"
      ? `node "${join(packageDistDir, "cli", "hook-entry.js").replace(/\\/g, "/")}" "$REPO_ROOT"`
      : `traceback-hook-entry "$REPO_ROOT"`;

  const chainBlock =
    chainFrom && existsSync(join(chainFrom, "post-commit"))
      ? `if [ -f "${join(chainFrom, "post-commit").replace(/\\/g, "/")}" ]; then\n  sh "${join(chainFrom, "post-commit").replace(/\\/g, "/")}" "$@" || true\nfi\n`
      : "";

  const ingestBlock = `if [ "$TRACEBACK_HOOK_BACKGROUND" = "1" ]; then
  ( ${tracebackBody} >/dev/null 2>&1 & )
else
  ${tracebackBody} >/dev/null 2>&1 || true
fi`;

  return `#!/bin/sh
# traceback post-commit hook
REPO_ROOT="$(git rev-parse --show-toplevel)"
${chainBlock}${ingestBlock}
`;
}

export function installGlobalHook(opts?: { chainFrom?: string; packageDistDir?: string }): void {
  const packageDistDir = opts?.packageDistDir ?? distDir;
  const globalHooksDir = resolve(homedir(), ".traceback", "hooks");
  const hookPath = join(globalHooksDir, "post-commit");

  if (!existsSync(globalHooksDir)) {
    mkdirSync(globalHooksDir, { recursive: true });
  }

  const script = renderPostCommitScript(packageDistDir, opts?.chainFrom);
  writeFileSync(hookPath, script, { mode: 0o755 });
  chmodSync(hookPath, 0o755);

  if (opts?.chainFrom) {
    console.log(`traceback: installed chained global post-commit hook at ${hookPath} (chains ${opts.chainFrom})`);
  } else {
    console.log(`traceback: installed global post-commit hook at ${hookPath}`);
  }
}

export function installHook(targetRepoPath: string, packageDistDir: string = distDir): void {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: targetRepoPath,
    encoding: "utf-8",
  }).trim();

  const gitPathHooks = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
    cwd: repoRoot,
    encoding: "utf-8",
  }).trim();
  const hooksDir = isAbsolute(gitPathHooks) ? gitPathHooks : join(repoRoot, gitPathHooks);
  const defaultHooksDir = join(repoRoot, ".git", "hooks");

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const hookPath = join(hooksDir, "post-commit");
  const script = renderPostCommitScript(packageDistDir);
  writeFileSync(hookPath, script, { mode: 0o755 });
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

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath || process.argv[1].replace(/\\/g, "/") === scriptPath.replace(/\\/g, "/")) {
  const targetRepoPath = process.argv[2] ?? process.cwd();
  installHook(targetRepoPath);
}
