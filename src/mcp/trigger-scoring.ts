export type TriggerDecision = "strong" | "weak" | "skip";

export interface TriggerKeywordContract {
  weak: string[];
  debug: string[];
  traceback: string[];
  negative: string[];
  weights: {
    weak: number;
    debug: number;
    traceback: number;
    negative: number;
  };
}

export interface TriggerScore {
  score: number;
  decision: TriggerDecision;
  matched: {
    weak: string[];
    debug: string[];
    traceback: string[];
    negative: string[];
  };
}

export const DEFAULT_TRIGGER_CONTRACT: TriggerKeywordContract = {
  weak: ["why", "how", "what", "where"],
  debug: ["bug", "fail", "error", "regression", "broken", "issue", "debug", "fix"],
  traceback: ["traceback", "session", "history", "commit", "search_with_fallback", "semantic", "recall"],
  negative: ["weather", "recipe", "joke", "movie", "travel", "sports"],
  weights: {
    weak: 0.3,
    debug: 1.0,
    traceback: 1.5,
    negative: -2.0,
  },
};

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function collectMatches(tokens: string[], keywords: string[]): string[] {
  const joined = ` ${tokens.join(" ")} `;
  const matches = new Set<string>();
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    if (needle.includes(" ")) {
      if (joined.includes(` ${needle} `)) matches.add(keyword);
      continue;
    }
    if (tokens.includes(needle)) matches.add(keyword);
  }
  return Array.from(matches);
}

export function scoreQueryForTrigger(
  query: string,
  opts: { strongThreshold: number; weakThreshold: number; contract?: TriggerKeywordContract },
): TriggerScore {
  const contract = opts.contract ?? DEFAULT_TRIGGER_CONTRACT;
  const tokens = tokenize(query);
  const matched = {
    weak: collectMatches(tokens, contract.weak),
    debug: collectMatches(tokens, contract.debug),
    traceback: collectMatches(tokens, contract.traceback),
    negative: collectMatches(tokens, contract.negative),
  };

  const score =
    matched.weak.length * contract.weights.weak +
    matched.debug.length * contract.weights.debug +
    matched.traceback.length * contract.weights.traceback +
    matched.negative.length * contract.weights.negative;

  let decision: TriggerDecision = "skip";
  if (score >= opts.strongThreshold) decision = "strong";
  else if (score >= opts.weakThreshold) decision = "weak";
  return { score, decision, matched };
}

export function triggerTermsCount(score: TriggerScore): number {
  return (
    score.matched.weak.length +
    score.matched.debug.length +
    score.matched.traceback.length +
    score.matched.negative.length
  );
}
