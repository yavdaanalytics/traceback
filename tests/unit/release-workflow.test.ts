import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const workflowPath = join(repoRoot, ".github", "workflows", "release-tag.yml");

describe("release-tag workflow invariants", () => {
  const yaml = readFileSync(workflowPath, "utf-8");

  it("builds before release:sync-plugins in sync-plugin-manifests-back", () => {
    const jobIdx = yaml.indexOf("sync-plugin-manifests-back:");
    expect(jobIdx).toBeGreaterThanOrEqual(0);
    const job = yaml.slice(jobIdx);
    const nextJob = job.search(/\n  [a-z0-9_-]+:/);
    const body = nextJob >= 0 ? job.slice(0, nextJob) : job;

    const buildIdx = body.search(/^\s+- name: Build\s*$/m);
    const syncIdx = body.indexOf("npm run release:sync-plugins");
    expect(buildIdx, "Build step required in sync-plugin-manifests-back").toBeGreaterThanOrEqual(0);
    expect(syncIdx, "release:sync-plugins required in sync-plugin-manifests-back").toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeLessThan(syncIdx);
  });

  it("release job also builds before sync-plugins", () => {
    const releaseIdx = yaml.indexOf("\n  release:");
    const syncJobIdx = yaml.indexOf("sync-plugin-manifests-back:");
    expect(releaseIdx).toBeGreaterThanOrEqual(0);
    const body = yaml.slice(releaseIdx, syncJobIdx);

    const buildIdx = body.search(/^\s+- name: Build\s*$/m);
    const syncIdx = body.indexOf("npm run release:sync-plugins");
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(syncIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeLessThan(syncIdx);
  });
});
