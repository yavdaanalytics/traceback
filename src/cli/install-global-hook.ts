#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = dirname(__dirname);

export function installGlobalHook(): void {
  const hooksDir = join(homedir(), ".traceback", "hooks");

  // Create global hooks directory
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
    console.log(`traceback: created global hooks directory at ${hooksDir}`);
  }

  // Read and install post-commit hook
  const templatePath = join(distDir, "..", "scripts", "post-commit.sh");
  const template = readFileSync(templatePath, "utf-8").replace(
    "__TRACEBACK_DIST_DIR__",
    distDir.replace(/\\/g, "/"),
  );

  const hookPath = join(hooksDir, "post-commit");
  writeFileSync(hookPath, template, { mode: 0o755 });
  chmodSync(hookPath, 0o755);

  console.log(`traceback: installed global post-commit hook at ${hookPath}`);

  // Set git config to use global hooks directory
  try {
    execFileSync("git", ["config", "--global", "core.hooksPath", hooksDir.replace(/\\/g, "/")], {
      encoding: "utf-8",
    });
    console.log(`traceback: set global core.hooksPath to ${hooksDir}`);
    console.log("traceback: ✓ Global hook setup complete - all repos will now auto-index sessions");
  } catch (err) {
    console.error("traceback: failed to set global git config:", err);
    process.exit(1);
  }
}

// Guarded execution - check if this file is being run directly (not imported)
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath || process.argv[1].replace(/\\/g, "/") === scriptPath.replace(/\\/g, "/")) {
  installGlobalHook();
}
