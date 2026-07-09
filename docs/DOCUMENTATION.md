# Documentation layering policy

This repo uses a **three-tier doc model**. Follow it when adding or editing user-facing text.

## Tier map

| Tier | File(s) | Audience | Purpose |
|------|---------|----------|---------|
| **Front door** | `README.md` | New users, GitHub visitors | What traceback is, why it matters, 5-minute quick start, funnel overview, privacy defaults, doc map |
| **Task guides** | `SETUP.md`, `SKILL.md`, `docs/TELEMETRY.md`, `docs/API.md`, `docs/ARCHITECTURE.md` | Users and integrators | Install, agent contract, telemetry, tool reference, deep architecture |
| **Contributor** | `CLAUDE.md`, `AGENTS.md`, `docs/DEV.md` | Maintainers and coding agents | Stack, conventions, tests, security, bench SLAs |

## README rules (strict)

**Keep in README:**
- One-line value proposition
- Funnel diagram + compact layer table
- Quick install (`build` + `traceback-setup`) with link to `SETUP.md`
- Privacy/telemetry defaults (plain setup OFF, plugin ON) — never hide these
- Documentation map (links to tier-2/3 docs)
- Brief limitations and contributing pointers

**Do not add to README** (put in the right doc instead):
- Full MCP tool tables → `docs/API.md`
- Per-IDE hook mechanics, flags, doctor output → `SETUP.md`
- Telemetry schema, KPI formulas, upload cron → `docs/TELEMETRY.md`
- L1–L4 subsection essays, storage ER detail → `docs/ARCHITECTURE.md`
- Security test paths, bench p95/p99 SLAs → `docs/DEV.md` / `CLAUDE.md`
- Agent HITL verbatim contracts → `SKILL.md` + tool descriptions in `src/mcp/index.ts`
- Internal roadmap / gap analysis → local `ROADMAP*.md` files (**gitignored** — never link from README or commit)

## When code changes

| Change | Update |
|--------|--------|
| New MCP tool | `src/mcp/index.ts`, `tests/contract/`, `docs/API.md` |
| Install / hooks / flags | `SETUP.md`, `src/cli/setup.ts` |
| Telemetry schema or defaults | `docs/TELEMETRY.md`, disclosure in `README.md` (defaults only) |
| Funnel layer behavior | `src/mcp/fallback.ts`, `docs/ARCHITECTURE.md`, README diagram if layers change |
| Bench SLA thresholds | `scripts/bench.mjs`, `docs/DEV.md` |

## Open source note

Implementation details live in `src/` — the README is not a secrecy boundary. Layer docs for **clarity and maintainability**, not to hide algorithms.

## Local-only roadmaps

`ROADMAP*.md` and `PROMPT.md` are **gitignored** (see root `.gitignore`). Keep planning notes there for local use; do not add them to the public doc map or link from committed markdown.
