#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../config.js";
import { searchWithFallback } from "../mcp/fallback.js";
import {
  extractQueryFromStdin,
  formatWarmStartContext,
  normalizeVsCodeHookEventName,
  wrapCursorReadResponse,
  wrapVsCodeResponse,
  type HookStdin,
  type WarmStartFormat,
} from "./warm-start-format.js";

function parseArgs(argv: string[]): {
  format: WarmStartFormat;
  repoPath: string;
  query?: string;
} {
  let format: WarmStartFormat = "plain";
  let repoPath = process.cwd();
  let query: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--format" && argv[i + 1]) {
      format = argv[++i] as WarmStartFormat;
    } else if (arg === "--repo-path" && argv[i + 1]) {
      repoPath = argv[++i];
    } else if (arg === "--query" && argv[i + 1]) {
      query = argv[++i];
    }
  }

  return { format, repoPath, query };
}

async function readStdinJson(): Promise<HookStdin> {
  if (process.stdin.isTTY) return {};
  const raw = readFileSync(0, "utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as HookStdin;
  } catch {
    return {};
  }
}

export async function runWarmStart(opts: {
  format: WarmStartFormat;
  repoPath: string;
  query?: string;
  stdin?: HookStdin;
}): Promise<string> {
  const stdin = opts.stdin ?? {};
  const query = extractQueryFromStdin(opts.format, stdin, opts.query);
  if (!query) {
    if (opts.format === "plain") {
      return JSON.stringify({ error: "missing query" });
    }
    if (opts.format === "vscode") {
      return wrapVsCodeResponse(normalizeVsCodeHookEventName(stdin.hook_event_name), "");
    }
    if (opts.format === "cursor-read") {
      return wrapCursorReadResponse("");
    }
    return "";
  }

  const config = resolveConfig(opts.repoPath);
  const result = await searchWithFallback(
    {
      repoPath: config.repoPath,
      dataDir: config.dataDir,
      sqlitePath: config.sqlitePath,
      confidenceThreshold: config.confidenceThreshold,
    },
    { query, project_path: config.repoPath },
  );

  const context = formatWarmStartContext(result);

  if (opts.format === "plain") {
    return JSON.stringify({ data: result, context }, null, 2);
  }
  if (opts.format === "vscode") {
    return wrapVsCodeResponse(normalizeVsCodeHookEventName(stdin.hook_event_name), context);
  }
  if (opts.format === "cursor-read") {
    return wrapCursorReadResponse(context);
  }
  return context;
}

async function main(): Promise<void> {
  const { format, repoPath, query } = parseArgs(process.argv);
  const stdin = await readStdinJson();
  try {
    const out = await runWarmStart({ format, repoPath, query, stdin });
    process.stdout.write(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (format === "plain") {
      process.stdout.write(JSON.stringify({ error: message }));
    } else if (format === "vscode") {
      process.stdout.write(wrapVsCodeResponse("UserPromptSubmit", `traceback warm-start failed: ${message}`));
    } else if (format === "cursor-read") {
      process.stdout.write(wrapCursorReadResponse(`traceback warm-start failed: ${message}`));
    }
    process.exitCode = 1;
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath || process.argv[1]?.replace(/\\/g, "/") === scriptPath.replace(/\\/g, "/")) {
  await main();
}
