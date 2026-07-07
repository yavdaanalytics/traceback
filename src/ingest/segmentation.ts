import type { NormalizedSession, ParsedSession, Turn } from "../adapters/types.js";

export const DEFAULT_SESSION_GAP_MS = 30 * 60 * 1000;

export function getSessionGapMs(): number {
  const env = process.env.TRACEBACK_SESSION_GAP_MS;
  return env ? Number(env) : DEFAULT_SESSION_GAP_MS;
}

function sortTurnsByTimestamp(turns: Turn[]): Turn[] {
  return [...turns].sort((a, b) => a.timestamp - b.timestamp);
}

/** Split ordered turns into segments separated by time gaps. */
export function segmentTurns(turns: Turn[], gapMs: number = getSessionGapMs()): Turn[][] {
  if (turns.length === 0) return [];
  const sorted = sortTurnsByTimestamp(turns);
  const segments: Turn[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.timestamp - prev.timestamp > gapMs) {
      segments.push([cur]);
    } else {
      segments[segments.length - 1].push(cur);
    }
  }
  return segments;
}

/** Produce NormalizedSession[] from a parsed session, one per time-gap segment. */
export function segmentSession(
  session: ParsedSession,
  opts: {
    transcriptRef: string;
    sourceFileKey: string;
    metadata?: NormalizedSession["metadata"];
    gapMs?: number;
  },
): NormalizedSession[] {
  const segments = segmentTurns(session.turns, opts.gapMs);
  return segments.map((turns, segmentIndex) => {
    const startedAt = turns[0]?.timestamp ?? session.startedAt;
    const endedAt = turns[turns.length - 1]?.timestamp ?? session.endedAt;
    const sessionId =
      segments.length === 1 ? session.sessionId : `${session.sessionId}:seg-${segmentIndex}`;
    return {
      ...session,
      sessionId,
      turns,
      startedAt,
      endedAt,
      transcriptRef: opts.transcriptRef,
      segmentIndex,
      sourceFileKey: `${opts.sourceFileKey}:seg-${segmentIndex}`,
      metadata: opts.metadata,
    };
  });
}
