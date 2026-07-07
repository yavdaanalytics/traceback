import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SymbolHit {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
}

const cacheDir = (dataDir: string) => join(dataDir, "..", "ast");

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function loadCache(dataDir: string, filePath: string, hash: string): SymbolHit[] | undefined {
  const cachePath = join(cacheDir(dataDir), `${hash}.json`);
  if (!existsSync(cachePath)) return undefined;
  try {
    return JSON.parse(readFileSync(cachePath, "utf-8")) as SymbolHit[];
  } catch {
    return undefined;
  }
}

function saveCache(dataDir: string, hash: string, hits: SymbolHit[]): void {
  const dir = cacheDir(dataDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${hash}.json`), JSON.stringify(hits));
}

/** Simple regex-based symbol search fallback when tree-sitter WASM is unavailable. */
function regexSymbolSearch(content: string, file: string, symbolName: string, type?: string): SymbolHit[] {
  const hits: SymbolHit[] = [];
  const patterns: Array<{ re: RegExp; kind: string }> = [
    { re: new RegExp(`function\\s+${symbolName}\\b`), kind: "function" },
    { re: new RegExp(`class\\s+${symbolName}\\b`), kind: "class" },
    { re: new RegExp(`(?:const|let|var)\\s+${symbolName}\\b`), kind: "variable" },
    { re: new RegExp(`def\\s+${symbolName}\\b`), kind: "function" },
    { re: new RegExp(`\\b${symbolName}\\b`), kind: "usage" },
  ];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const { re, kind } of patterns) {
      if (type && kind !== type && kind !== "usage") continue;
      if (re.test(lines[i])) {
        hits.push({ name: symbolName, kind, file, line: i + 1, column: lines[i].indexOf(symbolName) + 1 });
      }
    }
  }
  return hits;
}

export async function astSymbolSearch(
  repoPath: string,
  dataDir: string,
  symbolName: string,
  opts: { type?: string; scope?: string; path?: string; files?: string[] } = {},
): Promise<string> {
  const { readFileSync: read, existsSync: exists } = await import("node:fs");
  const { join: pathJoin, resolve, normalize } = await import("node:path");

  const targetFiles = opts.files ?? (opts.path ? [opts.path] : []);
  const hits: SymbolHit[] = [];

  const filesToScan =
    targetFiles.length > 0
      ? targetFiles.map((f) => pathJoin(repoPath, f))
      : [];

  if (filesToScan.length === 0) {
    return "(no files specified)";
  }

  for (const absPath of filesToScan) {
    const normalized = normalize(resolve(absPath));
    const root = normalize(resolve(repoPath));
    if (!normalized.startsWith(root)) {
      throw new Error(`Path traversal rejected: ${absPath}`);
    }
    if (!exists(normalized)) continue;
    const content = read(normalized, "utf-8");
    const hash = contentHash(content);
    const cached = loadCache(dataDir, normalized, hash);
    const fileHits = cached ?? regexSymbolSearch(content, normalized.replace(root + "/", ""), symbolName, opts.type);
    if (!cached) saveCache(dataDir, hash, fileHits);
    hits.push(...fileHits);
  }

  if (hits.length === 0) return "(no matches)";
  return hits.map((h) => `${h.file}:${h.line}:${h.column} [${h.kind}] ${h.name}`).join("\n");
}
