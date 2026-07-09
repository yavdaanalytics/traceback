#!/usr/bin/env bash
set -euo pipefail
cp /tmp/traceback-route.yml /opt/traefik/dynamic/traceback.yml
python3 -c "import yaml; yaml.safe_load(open('/opt/traefik/dynamic/traceback.yml'))"
docker kill --signal=HUP traefik
sleep 4
bash /opt/app/traceback/scripts/verify-droplet-routing.sh
