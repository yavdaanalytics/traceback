# Traceback Trigger Tuning Playbook

This playbook explains how to tune host-first keyword routing while keeping
semantic recall quality stable.

## Inputs

- Telemetry columns:
  - `trigger_score`
  - `trigger_decision`
  - `trigger_terms_count`
  - `response_tokens_est`
  - `baseline_tokens_est`
- Human outcomes:
  - `submit_feedback` (`confirm` / `reject`)

## Weekly review loop

1. Run `get_efficiency_report` and inspect:
   - token ratio for `search_with_fallback`
   - trigger decision distribution (`strong/weak/skip`)
2. Sample recent `reject` outcomes and identify noisy terms.
3. Sample recent `confirm` outcomes and identify high-signal terms.
4. Update keyword weights and thresholds conservatively.

## Safe tuning rules

- Never remove weak words (`why/how/what/where`); keep them low weight.
- Do not hard-block weak matches in balanced mode.
- Change one parameter group at a time:
  - term weights **or**
  - threshold values
- After changes, run unit/eval tests and compare token + recall trends.

## Suggested adjustment heuristics

- Too many false positives:
  - decrease `weak_terms` weight by 0.05–0.1
  - increase `strong_match` threshold by 0.1
- Too many misses:
  - increase `debug_terms` or `traceback_terms` by 0.1
  - decrease `weak_match` threshold by 0.1

## Rollback

If recall drops in evals or user-visible misses increase:

1. restore previous weights/thresholds
2. keep balanced host-first fallback enabled
3. rerun evals before next tuning pass

