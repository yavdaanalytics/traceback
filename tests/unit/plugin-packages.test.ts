import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  renderTracebackCursorRule,
  portableCursorHooksConfig,
  portableClaudeHooksConfig,
  portablePluginMcpConfig,
  TRACEBACK_CONFIG_KEY,
} from "../../src/cli/setup.js";

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
    hooksPath: join(repoRoot, "plugins", "cursor-traceback", "hooks", "hooks.json"),
    expectedManifestFields: ["skills", "rules", "hooks", "mcpServers"] as const,
    extraPaths: [
      join(repoRoot, "plugins", "cursor-traceback", "rules", "traceback.mdc"),
      join(repoRoot, "plugins", "cursor-traceback", "mcp.json"),
      join(repoRoot, "plugins", "cursor-traceback", "hooks", "hooks.json"),
    ],
  },
  {
    name: "claude-traceback",
    manifestPath: join(repoRoot, "plugins", "claude-traceback", ".claude-plugin", "plugin.json"),
    skillPath: join(repoRoot, "plugins", "claude-traceback", "skills", "traceback", "SKILL.md"),
    mcpPath: join(repoRoot, "plugins", "claude-traceback", "mcp.json"),
    hooksPath: join(repoRoot, "plugins", "claude-traceback", "hooks", "hooks.json"),
    expectedManifestFields: ["skills", "hooks", "mcpServers"] as const,
    extraPaths: [
      join(repoRoot, "plugins", "claude-traceback", "mcp.json"),
      join(repoRoot, "plugins", "claude-traceback", "hooks", "hooks.json"),
    ],
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
  it("keeps npm package version identical to Claude and Cursor plugin manifests", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
      version: string;
    };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);

    for (const plugin of pluginPackages) {
      const manifest = JSON.parse(readFileSync(plugin.manifestPath, "utf-8")) as {
        version?: string;
      };
      expect(manifest.version, `${plugin.name} version`).toBe(pkg.version);
    }
  });

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

  it("cursor rule matches renderTracebackCursorRule from setup", () => {
    const rulePath = join(repoRoot, "plugins", "cursor-traceback", "rules", "traceback.mdc");
    const bundled = normalize(readFileSync(rulePath, "utf-8"));
    const expected = normalize(renderTracebackCursorRule(TRACEBACK_CONFIG_KEY));
    expect(bundled).toBe(expected);
    expect(bundled).toContain("Host-first routing");
    expect(bundled).toContain("relevant_patterns");
  });

  it("cursor hooks match portableCursorHooksConfig from setup", () => {
    const hooksPath = join(repoRoot, "plugins", "cursor-traceback", "hooks", "hooks.json");
    const bundled = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(bundled).toEqual(portableCursorHooksConfig());
    expect(bundled.hooks.beforeReadFile[0].command).toContain("cursor-read");
    expect(bundled.hooks.preToolUse[0].matcher).toBe("Grep|Glob");
    expect(bundled.hooks.afterMCPExecution[0].matcher).toBe("search_with_fallback");
  });

  it("claude hooks match portableClaudeHooksConfig from setup", () => {
    const hooksPath = join(repoRoot, "plugins", "claude-traceback", "hooks", "hooks.json");
    const bundled = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(bundled).toEqual(portableClaudeHooksConfig());
    expect(bundled.hooks.UserPromptSubmit[0].hooks[0].tool).toBe("search_with_fallback");
    expect(bundled.hooks.PreToolUse[0].matcher).toBe("Read");
  });

  it("mcp.json matches portablePluginMcpConfig from setup", () => {
    const expected = portablePluginMcpConfig();
    for (const pkg of pluginPackages) {
      const mcp = JSON.parse(readFileSync(pkg.mcpPath, "utf-8"));
      expect(mcp).toEqual(expected);
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
        expect(mcp.mcpServers.traceback.args).toContain("@yavdaanalytics/traceback");
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
