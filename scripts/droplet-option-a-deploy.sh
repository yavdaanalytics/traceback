#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/app/traceback}"
COMPOSE_FILE="$APP_ROOT/deploy/droplet/docker-compose.yml"
DYNAMIC_DIR="/opt/traefik/dynamic"

echo "==> Option A: traceback-metrics via Docker labels on web network"
echo "==> app root: $APP_ROOT"

if [[ -f "$DYNAMIC_DIR/traceback.yml" ]]; then
  mv "$DYNAMIC_DIR/traceback.yml" "$DYNAMIC_DIR/traceback.yml.bak.$(date +%Y%m%d%H%M%S)"
  echo "==> quarantined stale $DYNAMIC_DIR/traceback.yml"
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "##[error] missing $COMPOSE_FILE"
  exit 1
fi

cd "$APP_ROOT"
docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate

# If Traefik still routes traceback to PBI, refresh docker provider (full restart, not HUP):
#   cd /opt/traefik && docker compose up -d traefik

echo "==> waiting for local metrics backend"
for i in $(seq 1 12); do
  if curl -fsS "http://127.0.0.1:5566/api/public/stats" >/dev/null 2>&1; then
    echo "==> local backend healthy"
    break
  fi
  sleep 5
  if [[ "$i" -eq 12 ]]; then
    echo "##[error] local backend not ready on :5566"
    docker logs traceback-metrics --tail 40 || true
    exit 1
  fi
done

docker inspect traceback-metrics --format 'networks={{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker inspect traceback-metrics --format '{{json .Config.Labels}}' | python3 -m json.tool | grep traefik || true

echo "==> Option A deploy complete"
