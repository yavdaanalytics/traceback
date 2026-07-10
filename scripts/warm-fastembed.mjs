#!/usr/bin/env node
/**
 * Pre-download the fastembed model once so parallel vitest workers do not
 * race on the same .tar.gz (which surfaces as ZlibError: unexpected end of file).
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const CACHE_DIR = resolve(process.cwd(), "local_cache");
const ATTEMPTS = Number(process.env.TRACEBACK_FASTEMBED_WARM_ATTEMPTS ?? 3);

function clearCache() {
  try {
    rmSync(CACHE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function warmOnce() {
  const { FlagEmbedding, EmbeddingModel } = await import("fastembed");
  await FlagEmbedding.init({
    model: EmbeddingModel.AllMiniLML6V2,
    cacheDir: CACHE_DIR,
    showDownloadProgress: false,
  });
}

let lastError;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    await warmOnce();
    process.stdout.write(`fastembed ready (attempt ${attempt}/${ATTEMPTS})\n`);
    process.exit(0);
  } catch (err) {
    lastError = err;
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fastembed warm failed (attempt ${attempt}/${ATTEMPTS}): ${msg}\n`);
    clearCache();
  }
}

throw lastError ?? new Error("fastembed warm failed");
