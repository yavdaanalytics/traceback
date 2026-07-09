#!/bin/sh
# Installed into ~/.traceback/hooks/post-commit (or per-repo hooks) by install-hook.ts.
# Never blocks the commit: hook-entry catches failures internally.
REPO_ROOT="$(git rev-parse --show-toplevel)"
traceback-hook-entry "$REPO_ROOT" >/dev/null 2>&1 || true
