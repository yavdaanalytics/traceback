# Privacy

How traceback handles data for open-source installs. Full telemetry schema and KPIs: [`docs/TELEMETRY.md`](TELEMETRY.md). Security reports: [`SECURITY.md`](../SECURITY.md).

## Summary (2026-07-10 review)

| Path | Default | What leaves the machine |
|------|---------|-------------------------|
| `traceback-setup` (plain) | Sharing **OFF** | Nothing unless you opt in |
| `traceback-setup --plugin` | Sharing **ON** (disclosure + `[Y/n]`) | Anonymous daily rollups to `https://traceback.yavda.com` only if you accept |
| Local MCP / hooks / SQLite | Always local | Session transcripts, queries, paths, commits stay in your repo `data/` and IDE stores |

## Uploaded when opted in

- Anonymous `install_id` (random UUID)
- `repo_hash` (not path or name)
- Package version, tool invocation counts, latency percentiles
- Aggregate warm-start line/token savings and routing counters

## Never uploaded

- Search queries, grep patterns, file paths
- Commit SHAs, messages, or session transcripts
- Email, username, or hostname

Enforced by the rollup schema (`src/telemetry/schema.ts`) and install disclosure (`src/telemetry/disclosure.ts`).

## Opt out

- At setup: answer `n`
- Anytime: `traceback-telemetry disable`
- Keep consent, stop auto-upload: `traceback-telemetry auto-upload off`

## Public metrics

Aggregates only: https://traceback.yavda.com (and `/privacy` on the collector).

## Jurisdiction note

Plugin default-on sharing is intentional for community effectiveness metrics, with install-time disclosure and easy opt-out. Operators should confirm this meets their local requirements before mandating `--plugin` installs in an organization.
