# Traceback Claude Plugin Package

This folder is the Claude plugin package shell for publishing and distribution.

## Telemetry

Plugin installs default **anonymous aggregate sharing to ON** when you run `traceback-setup --plugin`. Setup prints a full disclosure before you confirm.

**Collected when opted in:** invocation counts, latency percentiles, warm-start line/token savings, trigger routing stats, anonymous `install_id`, hashed `repo_hash`, traceback version.

**Never collected:** queries, file paths, commit SHAs/messages, session transcripts, email/username/hostname.

**Upload endpoint (when opted in):** `https://traceback.yavda.com`

**Opt out during install:** answer `n` at the setup prompt.

**Opt out anytime:** `traceback-telemetry disable` (or `traceback-telemetry auto-upload off` for manual-only uploads).

Full policy: [`docs/TELEMETRY.md`](../../docs/TELEMETRY.md).

## What this package includes

- **Skill** (`skills/traceback/SKILL.md`) — host-first keyword routing metadata
- **MCP server** (`mcp.json`) — `npx -y traceback` stdio server entry with telemetry env

Claude Code auto-discovers the skill on plugin enable. MCP warm-start hooks and per-repo wiring are configured by `traceback-setup --plugin`.

## Install in Claude

Install this plugin using your Claude marketplace flow for this package source.

After install, run these commands once per machine and once per repo:

```sh
# Global git indexing across all repos
npx -y traceback-install-global-hook

# Per-repo MCP merge, Claude hooks, and skill path sync
cd your-repo
npx -y traceback-setup --plugin
```

Setup shows what is collected, states that sharing defaults to **on** for plugin installs (`[Y/n]`), and how to opt out. Non-interactive runs auto-enable when `--plugin` is set. Use plain `traceback-setup` if you prefer the default-off prompt (`[y/N]`).

If Claude does not load bundled MCP from the plugin package, `traceback-setup --plugin` still merges the same telemetry env into your repo `.mcp.json`.

## Why extra CLI steps are required

- **Plugin install** bundles the host-first routing skill, MCP config, and telemetry defaults for Claude discovery.
- **Global git hook** (`traceback-install-global-hook`) sets `core.hooksPath` so post-commit indexing runs in all repos.
- **Per-repo setup** (`traceback-setup`) writes Claude `UserPromptSubmit` / `PreToolUse` MCP hooks in `~/.claude/settings.json`, merges `.mcp.json`, and syncs `SKILL.md` into `~/.claude/skills/traceback/SKILL.md` idempotently.

## Host-first routing

The bundled `skills/traceback/SKILL.md` defines deterministic keyword routing (`routing_mode: balanced_host_first`):

- **strong** or **weak** match → invoke `search_with_fallback`
- **skip** only for clearly non-code prompts

See repo root [`SKILL.md`](../../SKILL.md) and [`SETUP.md`](../../SETUP.md) for the full contract.

## Verify setup

1. Confirm plugin is enabled in Claude Code.
2. Confirm bundled skill is available (traceback-host-first-router).
3. Confirm global git hook path:

```sh
git config --global core.hooksPath
```

Expected value:

```text
~/.traceback/hooks
```

4. After `traceback-setup`, confirm:

```text
~/.claude/skills/traceback/SKILL.md
~/.claude/settings.json   (UserPromptSubmit + PreToolUse hooks)
```

5. Make a commit and confirm indexing artifacts under that repo's `data/` directory.

## Troubleshooting

- All install commands are idempotent and safe to re-run.
- On deferred-schema hosts, call `get_traceback_status` before generic grep/glob.
- Opt out of telemetry: `traceback-telemetry disable`
- If global `core.hooksPath` conflicts with company policy, use repo-local hooks: `npx -y traceback-install-hook`.

## Notes for maintainers

- Keep plugin assets aligned with:
  - `SKILL.md` (repo root — synced by `npm run release:sync-plugins`)
  - `src/cli/setup.ts` (`setupClaudeCodeHooks`, `installTracebackSkills`)
  - `src/cli/install-global-hook.ts`
  - `src/cli/install-hook.ts`
- Run `npm run release:sync-plugins` before release to sync versions + `SKILL.md` into both plugin packages.
