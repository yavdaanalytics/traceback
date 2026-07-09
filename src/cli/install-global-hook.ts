#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { installGlobalHook as installGlobalHookImpl } from "./install-hook.js";

export function installGlobalHook(): void {
  installGlobalHookImpl();
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath || process.argv[1]?.replace(/\\/g, "/") === scriptPath.replace(/\\/g, "/")) {
  installGlobalHook();
}
