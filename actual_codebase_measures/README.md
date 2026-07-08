# Actual Codebase Measures

Real-world measurements of traceback's warm-start funnel on production codebases, documenting the actual token & context savings vs blind grep.

## Purpose

These snapshots demonstrate traceback's value with **real queries on real repos** — not synthetic benchmarks or cherry-picked examples. Each measurement includes:

- **The query** that triggered the search
- **Traceback's results** (scoped, warm-started)
- **Blind grep baseline** (what you'd get without traceback)
- **Token/context comparison** (savings in dollars, context budget, latency)
- **Repo metadata** (size, complexity, domain)

## Files

### `powerbi-embedded-analytics-ciam-search.md`
- **Repo:** Multi-tenant SaaS with Azure CIAM auth, Power BI embedding
- **Query:** "CIAM authentication tenant isolation"
- **Finding:** 10,542 blind grep matches → 107 scoped results (99% noise reduction, 300K token savings)
- **Significance:** Cold-start L2/L3 funnel outperforms blind grep by 98.9% on token efficiency

## How to Generate Your Own

Run traceback on your repo with any real query:

```bash
cd your-repo
node C:/source/traceback/dist/mcp/index.js
# Call: search_with_fallback({ query: "your domain question here" })
```

Then compare to blind grep:

```bash
git grep -i "your search terms" | wc -l
git grep -i "your search terms" | head -100 | wc -c  # byte count
```

Divide bytes by 4 to estimate tokens, then document the comparison here.

## Why This Matters

- **Context is expensive**: A single 300K-token grep result eats 30% of your working window.
- **Traceback saves ~99% of that** on real codebases (not theory, measured).
- **Agent reasoning improves** when it can afford to read all results instead of guessing.
- **Development velocity** compounds: saving context on search → room for more follow-ups → fewer re-runs.

