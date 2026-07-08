---
name: traceback-host-first-router
description: Host-first routing metadata for deciding when traceback MCP should be invoked.
keywords:
  trigger:
    - debug
    - traceback
    - telemetry
    - regression
    - bug
    - session
    - history
    - commit
    - search code history
    - where is
    - find usage
  concepts:
    - semantic search
    - vector similarity
    - git history
    - ast symbol
    - fallback funnel
  tools:
    - get_traceback_status
    - get_connection_info
    - search_with_fallback
negative_keywords:
  - weather
  - recipe
  - joke
  - sports
thresholds:
  strong_match: 2.2
  weak_match: 0.8
weights:
  weak_terms: 0.3
  debug_terms: 1.0
  traceback_terms: 1.5
  negative_terms: -2.0
routing_mode: balanced_host_first
routing_contract:
  strong: "Invoke traceback MCP immediately."
  weak: "Invoke traceback MCP as fallback to avoid false negatives."
  skip: "Skip only for clearly non-code/non-debug prompts."
---

# Traceback Host-First Router

This file defines deterministic routing metadata for hosts that can prefilter
queries before calling traceback MCP tools. It is intentionally lightweight so
hosts can avoid expensive model reasoning on every prompt.

## Host-first contract

1. Evaluate prompt against metadata keywords/weights.
2. If **strong**, call `search_with_fallback`.
3. If **weak/ambiguous**, still call `search_with_fallback` (balanced fallback).
4. If **skip**, avoid traceback only for clearly unrelated prompts.

## Why broad words stay included

General words like `why/how/what/where` are intentionally included but low
weight, so they increase recall without dominating routing decisions.

## Tuning source of truth

- Trigger telemetry (`trigger_score`, `trigger_decision`, `trigger_terms_count`)
- `submit_feedback` outcomes
- Efficiency report token trends

