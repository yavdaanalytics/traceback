import { z } from "zod";

export const TelemetryRollupV1Schema = z.object({
  schema_version: z.literal("1"),
  install_id: z.string().uuid(),
  repo_hash: z.string().min(8).max(64),
  traceback_version: z.string().min(1),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tool_name: z.string().min(1),
  invocation_count: z.number().int().nonnegative(),
  failure_count: z.number().int().nonnegative(),
  duration_ms_p50: z.number().nonnegative(),
  duration_ms_p95: z.number().nonnegative(),
  lines_saved_total: z.number().int().nonnegative(),
  warm_lines_total: z.number().int().nonnegative(),
  baseline_lines_total: z.number().int().nonnegative(),
  feedback_confirm_count: z.number().int().nonnegative(),
  feedback_reject_count: z.number().int().nonnegative(),
  search_mode_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** Additive aggregates (optional for older clients / empty collector rows). */
  response_tokens_total: z.number().int().nonnegative().optional(),
  baseline_tokens_total: z.number().int().nonnegative().optional(),
  git_depth_days_avg: z.number().nonnegative().optional(),
  git_depth_days_p50: z.number().nonnegative().optional(),
  layer4_skipped_count: z.number().int().nonnegative().optional(),
  layer4_total_count: z.number().int().nonnegative().optional(),
  trigger_decision_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  trigger_score_avg: z.number().nonnegative().optional(),
  trigger_terms_count_avg: z.number().nonnegative().optional(),
  delta_window_scale_avg: z.number().nonnegative().optional(),
});

export type TelemetryRollupV1 = z.infer<typeof TelemetryRollupV1Schema>;

export const TelemetryRollupBatchSchema = z.array(TelemetryRollupV1Schema).min(1);
