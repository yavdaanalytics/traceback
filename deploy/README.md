# Deploying traceback-metrics (Phase 3 collector)

Self-host the public transparency collector that receives opted-in anonymous telemetry rollups.

## Quick start (local)

```sh
npm run build
traceback-metrics
```

Defaults:

- Host: `127.0.0.1` (`TRACEBACK_METRICS_HOST`)
- Port: `5566` (`TRACEBACK_METRICS_PORT`)
- DB: `~/.traceback/metrics-collector.db` (`TRACEBACK_METRICS_DB`)

## Docker

Build from the repo root [`Dockerfile`](../Dockerfile), then run the compiled `traceback-metrics` binary listening on port **5566**.

Example (replace hostname and TLS termination with your stack):

```sh
docker build -t traceback-metrics .
docker run --rm -p 5566:5566 \
  -e TRACEBACK_METRICS_HOST=0.0.0.0 \
  traceback-metrics
```

Put a reverse proxy (Traefik, nginx, Caddy) in front for HTTPS. Route `https://metrics.example.com` to container port 5566.

## Client configuration

Point opted-in installs at your collector:

```sh
export TRACEBACK_TELEMETRY_ENDPOINT=https://metrics.example.com
traceback-telemetry enable
traceback-telemetry upload
```

Plugin installs default to `https://traceback.yavda.com` when users accept sharing during `traceback-setup --plugin`. Override with `TRACEBACK_TELEMETRY_ENDPOINT` if you self-host.

## Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/v1/rollups` | POST | Ingest `TelemetryRollupV1[]` batches |
| `/api/public/stats` | GET | Aggregated JSON across installs |
| `/` | GET | Public HTML transparency page |

See [`docs/TELEMETRY.md`](../docs/TELEMETRY.md) for schema, redaction policy, and cron/`upload-due` setup.
