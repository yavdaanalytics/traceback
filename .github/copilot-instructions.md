# Copilot instructions — traceback repo

Follow the documentation layering policy in [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

## When editing docs

- Keep **`README.md`** as a short front door (~120 lines): value prop, quick start, funnel summary, privacy defaults, documentation map.
- Put install and hook details in **`SETUP.md`**.
- Put MCP tool tables in **`docs/API.md`** (update when registering tools in `src/mcp/index.ts`).
- Put architecture depth in **`docs/ARCHITECTURE.md`**.
- Put telemetry schema and KPIs in **`docs/TELEMETRY.md`**.
- Put security gates and bench SLAs in **`docs/DEV.md`**.
- Put stack, conventions, and testing layout in **`CLAUDE.md`**.

Do not grow README with API tables, per-IDE hook mechanics, or bench p95 numbers — link to the tier-2/3 doc instead.

## When changing code

| Change | Also update |
|--------|-------------|
| New MCP tool | `docs/API.md`, `tests/contract/` |
| Setup / hooks | `SETUP.md` |
| Funnel behavior | `docs/ARCHITECTURE.md`, `src/mcp/fallback.ts` |
| Telemetry | `docs/TELEMETRY.md`; README only if defaults change |

Open source: clarity over hiding details — implementation is in `src/`.

`ROADMAP*.md` is gitignored (local planning only) — do not link from README or commit roadmap files.
