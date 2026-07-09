# traceback Telemetry

Open, privacy-first telemetry for proving warm-start effectiveness across users.

> Full telemetry spec lives here — README only states opt-in defaults. Doc policy: [`DOCUMENTATION.md`](DOCUMENTATION.md).

## Rollout phases

| Phase | Status | What it does |
|-------|--------|--------------|
| **1 — Local observability** | Implemented | Per-call logging in `data/traceback.db`, local dashboard, structured export |
| **2 — Opt-in anonymous aggregates** | Implemented | Daily rollups uploaded only when explicitly enabled |
| **3 — Public transparency** | Implemented | Self-hosted `traceback-metrics` collector + public stats page |
| **4 — Enterprise mode** | Roadmap | Signed reports, org controls, compliance retention (not in OSS scope) |

Default behavior: **plain setup sharing is OFF**; **plugin setup (`--plugin`) sharing defaults ON** with install-time disclosure. All raw data stays local unless you opt in.

---

## Phase 1 — Local KPIs

### Storage

- SQLite: `data/traceback.db` → table `tool_invocations`
- Written by `withTelemetry()` on every MCP tool call

### KPI definitions

| KPI | Formula / source |
|-----|------------------|
| `invocation_count` | Count of `tool_invocations` rows per tool |
| `failure_count` | Rows where `ok = 0` |
| `avg_duration_ms` | Mean of `duration_ms` |
| `p50_duration_ms` / `p95_duration_ms` | Percentiles of `duration_ms` |
| `warm_lines_total` | Sum of `warm_lines_pulled` where present |
| `baseline_lines_total` | Sum of `baseline_lines` where present |
| `lines_saved_total` | Sum of `global_lines_skipped` (= `baseline_lines - warm_lines_pulled`, clamped at 0) |
| `line_reduction_pct` | `100 * lines_saved_total / baseline_lines_total` |
| `feedback_confirm_count` / `feedback_reject_count` | Counts from `feedback` table |
| `trigger_decision_counts` | Distribution of `trigger_decision` |
| `layer4_skipped_count` | Rows where `layer4_skipped = 1` |

### Commands

```sh
traceback-dashboard
traceback-telemetry export --local
traceback-telemetry status
```

MCP: `get_efficiency_report` with optional `format: "json"`.

---

## Phase 2 — Opt-in anonymous upload

### Config file

`~/.traceback/telemetry.json`:

```json
{
  "version": 1,
  "opt_in": false,
  "install_id": null,
  "last_upload_at": null,
  "last_uploaded_invocation_id": 0,
  "endpoint": null,
  "auto_upload": false,
  "upload_interval_hours": 24
}
```

- `install_id`: random UUID generated on opt-in (never email/username)
- `endpoint`: from `TRACEBACK_TELEMETRY_ENDPOINT` or config `endpoint`
- `auto_upload`: daily scheduled upload when `true` (default `false`; set `true` on `enable` / setup opt-in)
- `upload_interval_hours`: minimum hours between automatic uploads (default `24`)

Environment overrides (optional):

- `TRACEBACK_TELEMETRY_AUTO_UPLOAD=true|false`
- `TRACEBACK_TELEMETRY_UPLOAD_INTERVAL_HOURS=24`

### Enable / preview / upload

```sh
traceback-telemetry enable
export TRACEBACK_TELEMETRY_ENDPOINT=http://127.0.0.1:5566
traceback-telemetry status
traceback-telemetry preview
traceback-telemetry upload
traceback-telemetry upload --dry-run
traceback-telemetry upload-due
traceback-telemetry auto-upload off
traceback-telemetry auto-upload on
traceback-telemetry disable
```

**Defaults:** `opt_in: false`, `auto_upload: false`. `enable` (or setup `[y]`) sets **both** to `true` so daily auto-upload starts without a second step. `auto-upload off` keeps consent but uploads only via manual `upload`. `disable` turns off sharing and scheduling.

### Install-time disclosure

`traceback-setup` prints a disclosure block before the opt-in prompt:

- **Plain setup:** default OFF — `Share anonymous usage metrics? [y/N]`
- **Plugin setup** (`--plugin`): default ON — `Share anonymous usage metrics? [Y/n]`

The disclosure lists collected vs never-collected fields and opt-out instructions (`n` at prompt, `traceback-telemetry disable`, `traceback-telemetry auto-upload off`).

Plugin MCP configs (`plugins/*/mcp.json` and merged repo MCP entries from `traceback-setup --plugin`) set:

- `TRACEBACK_TELEMETRY_OPT_IN=true`
- `TRACEBACK_TELEMETRY_ENDPOINT=https://traceback.yavda.com`

Plain setup does not set these env vars unless you opt in at the prompt (endpoint from `TRACEBACK_TELEMETRY_ENDPOINT` env or self-hosted collector).

Non-interactive installs: set `TRACEBACK_TELEMETRY_OPT_IN=true|false`. **Plugin installs** use `traceback-setup --plugin` for default-on behavior when stdin is not a TTY.

### Scheduled auto-upload

| Trigger | When it uploads |
|---------|-----------------|
| **MCP startup** | Fire-and-forget if opted in, `auto_upload` on, endpoint set, and interval elapsed |
| **`upload-due` CLI** | All repos in `~/.traceback/repos.json` where due and `auto_upload` (for cron/Task Scheduler) |
| **`upload` CLI** | Manual; ignores `auto_upload` and due check |

Cron examples:

```sh
# Linux/macOS crontab (daily 03:00)
0 3 * * * TRACEBACK_TELEMETRY_ENDPOINT=https://traceback.yavda.com traceback-telemetry upload-due

# Windows Task Scheduler: daily run of traceback-telemetry upload-due
```

`upload-due --force` skips the due-time check (still requires `auto_upload`). Failures log one line to stderr and do not advance `last_uploaded_invocation_id`.

### Rollup event schema (`TelemetryRollupV1`)

```json
{
  "schema_version": "1",
  "install_id": "8f1c2c3a-7e5b-4ed6-87cc-4ce13c87a9a5",
  "repo_hash": "a1b2c3d4e5f67890",
  "traceback_version": "0.1.0",
  "period_start": "2026-07-08",
  "period_end": "2026-07-08",
  "tool_name": "search_with_fallback",
  "invocation_count": 12,
  "failure_count": 0,
  "duration_ms_p50": 28.4,
  "duration_ms_p95": 96.2,
  "lines_saved_total": 4200,
  "warm_lines_total": 180,
  "baseline_lines_total": 4380,
  "feedback_confirm_count": 2,
  "feedback_reject_count": 1,
  "search_mode_counts": { "cold_start_git_scoped": 8, "grep_full_repo": 4 },
  "response_tokens_total": 900,
  "baseline_tokens_total": 4200,
  "git_depth_days_avg": 21.5,
  "git_depth_days_p50": 14,
  "layer4_skipped_count": 3,
  "layer4_total_count": 12,
  "trigger_decision_counts": { "strong": 4, "weak": 7, "skip": 1 },
  "trigger_score_avg": 1.4,
  "trigger_terms_count_avg": 2.1,
  "delta_window_scale_avg": 2.5
}
```

Additive optional fields (still `schema_version: "1"`) are included when present on local invocations:

| Field | Aggregation |
|-------|-------------|
| `response_tokens_total` / `baseline_tokens_total` | Sums → public `token_reduction_pct` |
| `git_depth_days_avg` / `git_depth_days_p50` | Mean / p50 over rows with depth set |
| `layer4_skipped_count` / `layer4_total_count` | Counts where `layer4_skipped` is known |
| `trigger_decision_counts` | Map of decision → count |
| `trigger_score_avg` / `trigger_terms_count_avg` | Means over rows with values |
| `delta_window_scale_avg` | Mean over rows with scale set |

- `repo_hash` = first 16 hex chars of `sha256(normalize(repoRoot))`
- Rollups are grouped by UTC day + tool + traceback version
- Upload is incremental via `last_uploaded_invocation_id`

### Redaction policy (never uploaded)

| Field | Uploaded? |
|-------|-----------|
| `input_args` (queries, patterns, paths) | **No** |
| Session transcripts / intents | **No** |
| Commit SHAs / messages / raw `matched_ref` | **No** |
| File paths | **No** |
| Email / username / hostname | **No** |
| Anonymous `install_id` | Yes (opt-in only) |
| Hashed `repo_hash` | Yes (opt-in only) |
| Aggregate counters (incl. token/trigger/layer4) | Yes (opt-in only) |

---

## Phase 3 — Public transparency collector

### Local / self-hosted process

```sh
traceback-metrics
```

Defaults:

- Host: `127.0.0.1` (`TRACEBACK_METRICS_HOST`)
- Port: `5566` (`TRACEBACK_METRICS_PORT`)
- DB: `~/.traceback/metrics-collector.db` (`TRACEBACK_METRICS_DB`)

### Production hosting

Community collector: **`https://traceback.yavda.com`** (opt-in plugin uploads).

To self-host, see [`deploy/README.md`](../deploy/README.md) — Docker + reverse proxy on port **5566**, image from root [`Dockerfile`](../Dockerfile).

### Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/v1/rollups` | POST | Ingest `TelemetryRollupV1[]` batches |
| `/api/public/stats` | GET | Aggregated JSON across all opted-in installs |
| `/` | GET | Public HTML transparency page |

Point clients at your collector:

```sh
export TRACEBACK_TELEMETRY_ENDPOINT=https://traceback.yavda.com
traceback-telemetry enable
traceback-telemetry upload
```

Public stats show unique installs, unique repos (by hash), invocation totals, line-/token-reduction %, layer4 skip rate, trigger decision totals, and version breakdown — **no per-install drill-down**.

---

## Deferred (not in this rollout)

| Item | Notes |
|------|-------|
| **Phase 4 — Enterprise** | Signed monthly reports, org controls, retention/region pinning (not in OSS scope) |
| Collector API auth | No in-process API key yet; Traefik/basic auth later if needed |

OSS Phases 1–3 work without enterprise dependencies.
