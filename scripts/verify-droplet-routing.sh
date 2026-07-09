#!/usr/bin/env bash
set -euo pipefail

fail=0

check() {
  local name="$1"
  local url="$2"
  local expect_code="${3:-200}"
  local expect_substr="${4:-}"

  local body code
  body="$(mktemp)"
  code="$(curl -sS -o "$body" -w "%{http_code}" "$url" || echo 000)"
  if [[ "$code" != "$expect_code" ]]; then
    echo "FAIL $name: expected HTTP $expect_code got $code ($url)"
    head -c 200 "$body" || true
    echo
    fail=1
    rm -f "$body"
    return
  fi
  if [[ -n "$expect_substr" ]] && ! grep -q "$expect_substr" "$body"; then
    echo "FAIL $name: HTTP $code but body missing '$expect_substr' ($url)"
    head -c 200 "$body" || true
    echo
    fail=1
    rm -f "$body"
    return
  fi
  echo "OK   $name: HTTP $code ($url)"
  rm -f "$body"
}

echo "==> Routing smoke tests"

check "traceback-stats" "https://traceback.yavda.com/api/public/stats" 200 '"unique_installs"'
check "pbi-embed" "https://pbi-embed.yavda.com/" 200 ""
check "pbivizedit" "https://pbivizedit.yavda.com/" 200 ""
check "dataallegro" "https://dataallegro.com/" 200 ""
check "www-dataallegro" "https://www.dataallegro.com/" 200 ""

if [[ "$fail" -ne 0 ]]; then
  echo "##[error] one or more routing checks failed"
  exit 1
fi

echo "==> all routing checks passed"
