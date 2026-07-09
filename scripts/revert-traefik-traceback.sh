#!/usr/bin/env bash
set -euo pipefail
DYNAMIC_DIR="/opt/traefik/dynamic"
if [[ -f "$DYNAMIC_DIR/traceback.yml" ]]; then
  mv "$DYNAMIC_DIR/traceback.yml" "$DYNAMIC_DIR/traceback.yml.reverted.$(date +%Y%m%d%H%M%S)"
  echo "==> removed traceback.yml from dynamic config"
fi
cd /opt/traefik
docker compose up -d traefik
sleep 8
docker ps --filter name=traefik --format '{{.Names}} {{.Status}}'
bash /opt/app/traceback/scripts/verify-droplet-routing.sh || true
# traceback expected to fail until routing fixed; others must pass
for url in https://pbi-embed.yavda.com/ https://pbivizedit.yavda.com/ https://dataallegro.com/ https://www.dataallegro.com/; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$url" || echo 000)
  echo "check $url -> $code"
  [[ "$code" == "200" ]] || exit 1
done
echo "==> prod sites restored"
