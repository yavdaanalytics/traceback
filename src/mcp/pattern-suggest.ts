import { countCodingPatterns, listCodingPatterns, type ToolInvocationRow } from "../storage/sqlite.js";

export interface PatternSuggestion {
  title: string;
  trigger_text: string;
  suggested_guidance: string;
  occurrence_count: number;
  suggest_promote: true;
}

function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractQuery(argsJson: string): string | null {
  try {
    const args = JSON.parse(argsJson) as { query?: unknown };
    return typeof args.query === "string" ? normalizeQuery(args.query) : null;
  } catch {
    return null;
  }
}

export function suggestPatternsFromInvocations(rows: ToolInvocationRow[]): PatternSuggestion[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const q = extractQuery(row.input_args);
    if (!q) continue;
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([query, count]) => ({
      title: `Repeated pattern: ${query.slice(0, 50)}`,
      trigger_text: query,
      suggested_guidance: "Consider promoting this repeated issue into a reusable coding pattern.",
      occurrence_count: count,
      suggest_promote: true as const,
    }));
}

export function getRelevantPatternsForQuery(
  sqlitePath: string,
  repoPath: string,
  query: string,
): Array<{ pattern_id: number; title: string; guidance: string; trigger_text: string }> {
  const normalized = normalizeQuery(query);
  const patterns = listCodingPatterns(sqlitePath, repoPath);
  return patterns
    .filter((pattern) => {
      const trigger = normalizeQuery(pattern.trigger_text);
      return normalized.includes(trigger) || trigger.includes(normalized) || trigger.split(" ").some((w) => normalized.includes(w));
    })
    .slice(0, 3)
    .map((pattern) => ({
      pattern_id: pattern.pattern_id,
      title: pattern.title,
      guidance: pattern.guidance,
      trigger_text: pattern.trigger_text,
    }));
}

export function patternStatus(sqlitePath: string, repoPath: string): { active_patterns: number } {
  return { active_patterns: countCodingPatterns(sqlitePath, repoPath) };
}

