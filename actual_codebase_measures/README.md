# Actual Codebase Measures

Real-world measurements of traceback's warm-start funnel on production codebases, documenting the actual token & context savings vs blind grep.

## Purpose

These snapshots demonstrate traceback's value with **real queries on real repos** — not synthetic benchmarks or cherry-picked examples. Each measurement includes:

- **The query** that triggered the search
- **Traceback's results** (scoped, warm-started)
- **Blind grep baseline** (what you'd get without traceback)
- **Token/context comparison** (savings in context budget, latency)
- **Repo metadata** (size, complexity, domain)

## Files

### `powerbi-embedded-analytics-ciam-search.md`

- **Repo:** Private multi-tenant SaaS with Azure CIAM auth, Power BI embedding (~100K LOC)
- **Query:** "CIAM authentication tenant isolation"
- **Finding:** 10,542 blind grep matches → 107 scoped results (99% noise reduction, ~300K token savings)
- **Measurement type:** Search results noise reduction
- **Fixture:** [`fixtures/powerbi-ciam-proof/invocation-1.json`](../fixtures/powerbi-ciam-proof/invocation-1.json) (redacted telemetry)
- **Re-run:** `npm run build && npm run proof:powerbi` (local checkout required; repo is not public)

### `powerbi-embedded-analytics-debugging-session.md`

- **Repo:** Same multi-tenant SaaS (c:/source/powerbi-embedded-analytics)
- **Scenario:** Prod CIAM test failure debugging + 3 auth fixes validation
- **Finding:** 22,500 tokens (without traceback) → 8,500 tokens (with traceback) = **62% reduction**
- **Measurement type:** Agent session efficiency (file reads + agent spawns vs traceback MCP calls)
- **Key insight:** Agent spawns are the biggest token sink (~10K); traceback replaces them with cheap MCP calls
- **Applicability:** Any debugging session involving repeating patterns (auth, config, test failures)

## How to Generate Your Own

On any repo where traceback is set up:

```bash
cd your-repo
npm run build   # in traceback checkout
npm run proof:powerbi -- --repo /path/to/your-repo
```

Or call `search_with_fallback` via MCP and compare to blind grep:

```bash
git grep -i -E "your|terms" | wc -l
```

Document the comparison in a new markdown file under this directory.

## Why This Matters

- **Context is expensive**: A single 300K-token grep result eats a large share of your working window.
- **Traceback saves ~99% of that** on real codebases (measured, not theoretical).
- **Agent reasoning improves** when it can afford to read all results instead of guessing.
