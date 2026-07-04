# traceback

Semantic debugger MCP server: warm-starts grep/git with cosine-similarity recall
over past coding-agent sessions, so an LLM agent scopes searches instead of
grepping the whole repo blind.

`traceback` is a standalone [MCP](https://modelcontextprotocol.io) server — the
same process works with any MCP-compatible client. There is no separate
"plugin" per editor; only each client's config file location/shape differs.

## Quick install

From the root of the git repo you want `traceback` to index:

```sh
npx traceback-setup
```

This installs the git post-commit hook and, for any of the config files below
that already exist in your repo, merges in the `traceback` MCP server entry.
Configs for hosts you don't use are left untouched — it never creates a config
file for a host you haven't already set up.

Run it again any time; it's idempotent, and it will warn (not overwrite) if it
finds a `traceback` entry that doesn't match what it would write, in case
you've customized it.

## Manual install (or unsupported hosts)

If your client isn't auto-detected, or you'd rather wire it up by hand, add an
entry pointing at `node <path-to-traceback>/dist/mcp/index.js`. The key name
differs per host:

### Claude Code — `.mcp.json`
```json
{
  "mcpServers": {
    "traceback": { "command": "node", "args": ["<path-to-traceback>/dist/mcp/index.js"] }
  }
}
```

### Cursor — `.cursor/mcp.json`
```json
{
  "mcpServers": {
    "traceback": { "command": "node", "args": ["<path-to-traceback>/dist/mcp/index.js"] }
  }
}
```

### VS Code / GitHub Copilot — `.vscode/mcp.json`
```json
{
  "servers": {
    "traceback": { "command": "node", "args": ["<path-to-traceback>/dist/mcp/index.js"] }
  }
}
```

### Any other MCP-compatible client (Windsurf, Zed, JetBrains AI Assistant, etc.)
Consult that client's own MCP documentation for its config file location and
top-level key (it will be one of `mcpServers` or `servers`), and use the same
`{ "command": "node", "args": ["<path-to-traceback>/dist/mcp/index.js"] }`
entry shown above.

## Development

```sh
npm run build              # tsc -p tsconfig.json
npm test                   # full vitest suite (unit + integration + e2e + regression + evals)
npm run test:unit          # tests/unit only
npm run test:integration   # tests/integration only (real fastembed + LanceDB)
npm run test:e2e           # spawns the built server, drives it over real stdio JSON-RPC
npm run test:regression    # pinned-behavior + security-invariant guards
npm run test:evals         # scripted agent-facing quality checks (recall, funnel efficiency)
npm run bench               # perf benchmarks at 1k/5k/10k-row scale (run after npm run build)
npm run security:sast       # Semgrep static analysis (requires `pip install semgrep` once)
npm run security:audit      # npm audit
```

See `CLAUDE.md` for the stack, conventions, and full testing details.
