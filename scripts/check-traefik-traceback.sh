#!/usr/bin/env bash
docker logs traefik 2>&1 | grep 'Configuration received' | grep providerName=docker | tail -1 | grep -q traceback-metrics && echo docker_config_has_traceback=yes || echo docker_config_has_traceback=no
docker logs traefik 2>&1 | grep 'Configuration received' | grep providerName=file | tail -1 | grep -q yavda-client-portals && echo file_has_catchall=yes || echo file_has_catchall=no
curl -kfsS -H 'Host: traceback.yavda.com' https://127.0.0.1/api/public/stats >/dev/null && echo traefik_route_ok=yes || echo traefik_route_ok=no
curl -fsS http://127.0.0.1:5566/api/public/stats >/dev/null && echo direct_ok=yes || echo direct_ok=no
