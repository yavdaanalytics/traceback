export type SourceLabel =
  | "session_vector"
  | "git_pickaxe"
  | "git_blame"
  | "git_intent"
  | "grep_scoped"
  | "grep_full_repo"
  | "ast_symbol"
  | "ast_grep"
  | "diff_search"
  | "keyword_search";

export type Certainty = "probabilistic" | "deterministic";

export interface ResponseMeta {
  source: SourceLabel;
  certainty: Certainty;
  layer?: 1 | 2 | 3 | 4;
}

export function wrapWithMeta<T>(data: T, meta: ResponseMeta): { data: T; meta: ResponseMeta } {
  return { data, meta };
}

export function sourceCertainty(source: SourceLabel): Certainty {
  return source === "session_vector" || source === "git_intent" ? "probabilistic" : "deterministic";
}
