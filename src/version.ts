import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function tracebackVersion(): string {
  const raw = readFileSync(join(packageRoot, "package.json"), "utf-8");
  return (JSON.parse(raw) as { version: string }).version;
}
