import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const releaseTagPath = join(repoRoot, ".github", "workflows", "release-tag.yml");
const marketplacePath = join(repoRoot, ".github", "workflows", "publish-marketplace.yml");

describe("release-tag workflow invariants", () => {
  const yaml = readFileSync(releaseTagPath, "utf-8");

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

  it("calls publish-marketplace reusable workflow after release on tags", () => {
    expect(yaml).toContain("publish-marketplace:");
    expect(yaml).toContain("uses: ./.github/workflows/publish-marketplace.yml");
    expect(yaml).toContain("needs: release");
    expect(yaml).toMatch(/publish-marketplace:[\s\S]*if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  });
});

describe("publish-marketplace workflow invariants", () => {
  const yaml = readFileSync(marketplacePath, "utf-8");

  it("is callable + dispatchable, not workflow_run+branches", () => {
    expect(yaml).toContain("workflow_call:");
    expect(yaml).toContain("workflow_dispatch:");
    expect(yaml).not.toMatch(/workflow_run:\s*\n\s*workflows:/);
    expect(yaml).not.toMatch(/branches:\s*\[main/);
  });

  it("checks out the release tag and pushes marketplace on changes only", () => {
    expect(yaml).toContain("ref: ${{ steps.ver.outputs.tag }}");
    expect(yaml).toContain("git diff --cached --quiet");
    expect(yaml).toContain("plugins/cursor-traceback");
  });
});
