import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const rootSkillPath = join(repoRoot, "SKILL.md");

const EXPECTED_TELEMETRY_ENV = {
  TRACEBACK_TELEMETRY_OPT_IN: "true",
  TRACEBACK_TELEMETRY_ENDPOINT: "https://traceback.yavda.com",
} as const;

const pluginPackages = [
  {
    name: "cursor-traceback",
    manifestPath: join(repoRoot, "plugins", "cursor-traceback", ".cursor-plugin", "plugin.json"),
    skillPath: join(repoRoot, "plugins", "cursor-traceback", "skills", "traceback", "SKILL.md"),
    mcpPath: join(repoRoot, "plugins", "cursor-traceback", "mcp.json"),
    expectedManifestFields: ["skills", "rules", "mcpServers"] as const,
    extraPaths: [
      join(repoRoot, "plugins", "cursor-traceback", "rules", "traceback.mdc"),
      join(repoRoot, "plugins", "cursor-traceback", "mcp.json"),
    ],
  },
  {
    name: "claude-traceback",
    manifestPath: join(repoRoot, "plugins", "claude-traceback", ".claude-plugin", "plugin.json"),
    skillPath: join(repoRoot, "plugins", "claude-traceback", "skills", "traceback", "SKILL.md"),
    mcpPath: join(repoRoot, "plugins", "claude-traceback", "mcp.json"),
    expectedManifestFields: ["skills", "mcpServers"] as const,
    extraPaths: [join(repoRoot, "plugins", "claude-traceback", "mcp.json")],
  },
];

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function readPluginMcp(path: string) {
  return JSON.parse(readFileSync(path, "utf-8")) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };
}

describe("plugin packages", () => {
  it("bundle host-first SKILL.md synced from repo root", () => {
    const rootSkill = normalize(readFileSync(rootSkillPath, "utf-8"));
    expect(rootSkill).toContain("routing_mode: balanced_host_first");

    for (const pkg of pluginPackages) {
      expect(existsSync(pkg.skillPath), `${pkg.name} skill missing`).toBe(true);
      const pluginSkill = normalize(readFileSync(pkg.skillPath, "utf-8"));
      expect(pluginSkill).toContain("routing_mode: balanced_host_first");
      expect(pluginSkill).toContain("<!-- traceback-skill -->");
      expect(pluginSkill).toContain("name: traceback-host-first-router");
      expect(rootSkill).toContain("name: traceback-host-first-router");
    }
  });

  for (const pkg of pluginPackages) {
    describe(pkg.name, () => {
      it("manifest references bundled components", () => {
        const manifest = JSON.parse(readFileSync(pkg.manifestPath, "utf-8")) as Record<string, unknown>;
        for (const field of pkg.expectedManifestFields) {
          expect(manifest[field], `missing ${field}`).toBeTruthy();
        }
        expect(manifest.keywords).toContain("host-first-routing");
      });

      it("includes required bundled files", () => {
        expect(existsSync(pkg.skillPath)).toBe(true);
        for (const path of pkg.extraPaths) {
          expect(existsSync(path), `missing ${path}`).toBe(true);
        }
      });

      it("mcp.json uses portable npx entry with telemetry env", () => {
        const mcp = readPluginMcp(pkg.mcpPath);
        expect(mcp.mcpServers.traceback.command).toBe("npx");
        expect(mcp.mcpServers.traceback.args).toContain("traceback");
        expect(mcp.mcpServers.traceback.env.TRACEBACK_TELEMETRY_OPT_IN).toBe(
          EXPECTED_TELEMETRY_ENV.TRACEBACK_TELEMETRY_OPT_IN,
        );
        expect(mcp.mcpServers.traceback.env.TRACEBACK_TELEMETRY_ENDPOINT).toBe(
          EXPECTED_TELEMETRY_ENV.TRACEBACK_TELEMETRY_ENDPOINT,
        );
      });
    });
  }

  it("both plugin mcp.json files share the same telemetry env keys", () => {
    const envKeys = pluginPackages.map((pkg) =>
      Object.keys(readPluginMcp(pkg.mcpPath).mcpServers.traceback.env).sort(),
    );
    expect(envKeys[0]).toEqual(envKeys[1]);
  });
});
