#!/bin/sh
# Installed into a target repo's .git/hooks/post-commit by
# src/cli/install-hook.ts. Never blocks the commit: hook-entry.js itself
# catches all failures internally, and we additionally suppress this
# script's own exit code so a missing/broken Node install can't fail commits.
REPO_ROOT="$(git rev-parse --show-toplevel)"
node "__TRACEBACK_DIST_DIR__/cli/hook-entry.js" "$REPO_ROOT" >/dev/null 2>&1 || true
