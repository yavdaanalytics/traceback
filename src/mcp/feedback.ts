import { getSession, getToolInvocation, incrementPenaltyWeight, insertFeedback } from "../storage/sqlite.js";

export const PENALTY_STEP = 0.2;

export interface SubmitFeedbackResult {
  feedback_id: number;
  penalized_session_ids: string[];
}

// Resolves which session_id(s) a reject should penalize: an explicit
// sessionId wins; otherwise fall back to the input_args recorded for the
// referenced invocation (session_id / session_ids fields, if present). A
// reject with neither (e.g. on an ast_search call) still records the
// feedback row, just with nothing to penalize.
function resolveSessionIds(sqlitePath: string, invocationId?: number, sessionId?: string): string[] {
  if (sessionId) return [sessionId];
  if (invocationId == null) return [];
  const inv = getToolInvocation(sqlitePath, invocationId);
  if (!inv) return [];
  try {
    const args = JSON.parse(inv.input_args) as Record<string, unknown>;
    if (typeof args.session_id === "string") return [args.session_id];
    if (Array.isArray(args.session_ids)) {
      return args.session_ids.filter((s): s is string => typeof s === "string");
    }
  } catch {
    // Malformed args JSON - nothing to penalize.
  }
  return [];
}

export function submitFeedback(
  sqlitePath: string,
  input: { invocationId?: number; sessionId?: string; verdict: "confirm" | "reject"; note?: string },
): SubmitFeedbackResult {
  const feedbackId = insertFeedback(sqlitePath, {
    invocation_id: input.invocationId ?? null,
    session_id: input.sessionId ?? null,
    verdict: input.verdict,
    note: input.note ?? null,
    created_at: Date.now(),
  });

  let penalized: string[] = [];
  if (input.verdict === "reject") {
    penalized = resolveSessionIds(sqlitePath, input.invocationId, input.sessionId);
    for (const sid of penalized) {
      if (getSession(sqlitePath, sid)) incrementPenaltyWeight(sqlitePath, sid, PENALTY_STEP);
    }
  }
  return { feedback_id: feedbackId, penalized_session_ids: penalized };
}
