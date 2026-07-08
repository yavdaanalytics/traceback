const STOP_WORDS = new Set([
  "is",
  "the",
  "grep",
  "search",
  "find",
  "get",
  "implemented",
  "working",
  "done",
  "how",
  "what",
  "where",
]);

function tokenize(query: string): string[] {
  return query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export interface DerivedGrepPattern {
  pattern: string;
  includeDocs: boolean;
}

export function deriveGrepPattern(query: string): DerivedGrepPattern {
  const includeDocs = /\b(doc|docs|readme|setup|guide|help|example)\b/i.test(query);
  const meaningful = tokenize(query).filter((token) => {
    const normalized = token.toLowerCase();
    if (STOP_WORDS.has(normalized)) return false;
    return normalized.length > 2 || /[-_/]/.test(token);
  });
  const terms = meaningful.length > 0 ? meaningful : tokenize(query);
  const pattern = terms.map((term) => `(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`).join("|");
  return { pattern: pattern || query, includeDocs };
}

export function defaultGrepExcludes(includeDocs: boolean): string[] {
  if (includeDocs) return [];
  return [":(exclude)*.md", ":(exclude)*.mdc", ":(exclude)*.txt", ":(exclude)docs/**", ":(exclude)dist/**"];
}
