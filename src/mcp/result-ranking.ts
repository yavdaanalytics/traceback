export interface GrepHit {
  file: string;
  line: number;
  content: string;
}

export interface RankedGrepHit extends GrepHit {
  score: number;
}

function isCommentOnly(content: string): boolean {
  return /^\s*(\/\/|#|\/\*|\*\/|\*\s)/.test(content);
}

function sourceTier(file: string): number {
  const lower = file.toLowerCase();
  if (lower.startsWith("src/")) return 3;
  if (lower.includes("/test") || lower.startsWith("tests/")) return 2;
  if (lower.endsWith(".md") || lower.endsWith(".mdc") || lower.endsWith(".txt")) return 0;
  return 1;
}

export function rankGrepHits(
  hits: GrepHit[],
  ctx: {
    sessionFiles?: Set<string>;
    gitSignalsByFile?: Map<string, string[]>;
    sessionOutcome?: string | null;
    maxPerFile?: number;
    maxTotal?: number;
  },
): RankedGrepHit[] {
  const ranked = hits.map((hit) => {
    let score = 0.5;
    if (ctx.sessionFiles?.has(hit.file)) score += 0.25;
    const signals = ctx.gitSignalsByFile?.get(hit.file) ?? [];
    if (signals.includes("intent")) score += 0.2;
    if (signals.length > 0) score += 0.1;
    if (ctx.sessionOutcome === "kept") score += 0.1;
    if (ctx.sessionOutcome === "reverted") score -= 0.1;
    if (isCommentOnly(hit.content)) score -= 0.2;
    score += sourceTier(hit.file) * 0.08;
    return { ...hit, score };
  });

  ranked.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);

  const maxPerFile = ctx.maxPerFile ?? 3;
  const maxTotal = ctx.maxTotal ?? 15;
  const perFile = new Map<string, number>();
  const deduped: RankedGrepHit[] = [];
  for (const hit of ranked) {
    const seen = perFile.get(hit.file) ?? 0;
    if (seen >= maxPerFile) continue;
    perFile.set(hit.file, seen + 1);
    deduped.push(hit);
    if (deduped.length >= maxTotal) break;
  }
  return deduped;
}

export function isStructuralQuery(query: string): boolean {
  return /\b(function|method|class|interface|type|import|export|caller|dependency|implement)\b/i.test(query);
}

