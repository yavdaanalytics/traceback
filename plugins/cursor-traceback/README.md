# Traceback Cursor Plugin Package

This folder is the Cursor plugin package shell for publishing and distribution.

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
- **Rule** (`rules/traceback.mdc`) — always-on warm-start contract
- **MCP server** (`mcp.json`) — `npx -y @yavdaanalytics/traceback` stdio server entry

## Install in Cursor

Install this plugin from your intended Cursor marketplace/private distribution flow.

After install, run **once per machine** (recommended):

```sh
npx -y -p @yavdaanalytics/traceback traceback-setup --plugin --yes-all-repos
```

This configures portable global MCP (`~/.cursor/mcp.json`), global Cursor hooks, global git indexing, and skills — no per-repo steps required.

Optional per-repo merge when project-level MCP files already exist:

```sh
cd your-repo
npx -y -p @yavdaanalytics/traceback traceback-setup --plugin --repo-only
```

Per-repo setup also adds a **Traceback debugging** section to `CLAUDE.md` (creates the file if missing). Refresh with `--claude-md-only`; skip with `--skip-claude-md`.

Verify: `traceback-setup --doctor`

Setup shows what is collected, states that sharing defaults to **on** for plugin installs (`[Y/n]`), and how to opt out. Non-interactive runs auto-enable when `--plugin` is set. Use plain `traceback-setup` if you prefer the default-off prompt (`[y/N]`).

## Why extra CLI steps are required

- **Plugin install** bundles skill metadata, rules, and MCP config for Cursor discovery.
- **Global setup** (`traceback-setup --yes-all-repos`) sets portable MCP, global hooks, `core.hooksPath`, and git excludes in one step.
- **Per-repo setup** (`traceback-setup --repo-only`) is optional when you need project-level MCP merges or repo-local warm-start rules.

## Host-first routing

The bundled `skills/traceback/SKILL.md` defines deterministic keyword routing (`routing_mode: balanced_host_first`):

- **strong** or **weak** match → invoke `search_with_fallback`
- **skip** only for clearly non-code prompts

See repo root [`SKILL.md`](../../SKILL.md) and [`SETUP.md`](../../SETUP.md) for the full contract.

## Verify setup

1. Confirm plugin is enabled in Cursor Customize → Plugins.
2. Confirm bundled skill is listed (traceback-host-first-router).
3. Confirm global git hook path:

```sh
git config --global core.hooksPath
```

Expected value:

```text
~/.traceback/hooks
```

4. After `traceback-setup` in a repo, confirm:

```text
.cursor/hooks.json
.cursor/rules/traceback.mdc
.cursor/skills/traceback/SKILL.md   (optional sync copy)
~/.cursor/skills/traceback/SKILL.md
```

5. Make a commit and confirm indexing artifacts under that repo's `data/` directory.

## Troubleshooting

- All install commands are idempotent and safe to re-run.
- If MCP routing fails, call `get_connection_info` and use the returned `call_server_id` (`traceback` vs `user-traceback`).
- Opt out of telemetry: `traceback-telemetry disable`
- If global `core.hooksPath` conflicts with company policy, use repo-local hooks: `npx -y -p @yavdaanalytics/traceback traceback-install-hook`.

## Notes for maintainers

- Keep plugin assets aligned with `src/cli/setup.ts` portable helpers (`renderTracebackCursorRule`, `portableCursorHooksConfig`, `portablePluginMcpConfig`, …).
- Run `npm run build && npm run release:sync-plugins` before release to sync versions, skill, rule, hooks, and mcp into both plugin packages.
