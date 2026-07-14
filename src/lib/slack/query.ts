/**
 * Heuristic natural-language → search-query extraction (pure, unit-tested).
 * Used as the fallback when no LLM API key is configured, and as the safety
 * net when the LLM call fails.
 */

const FILLER_PATTERNS: RegExp[] = [
  /^(hey|hi|hello|yo|please|pls)[,!\s]+/i,
  /\b(can|could|would|will)\s+(you|u)\b/gi,
  /\b(please|pls|plz)\b/gi,
  /\b(find|search( for)?|look( for| up)?|locate|get|fetch|show( me)?|pull up|dig up|grab)\b/gi,
  /\b(the|a|an|me|my|our|us|for|about|on|of|that|this|some)\b/gi,
  /\b(doc(ument)?s?|page(s)?|note(s)?|file(s)?)\b/gi,
  /\b(and (return|share|post|send)( it)?( here)?( with .*)?)\b/gi,
  /\b(thanks?( you)?|thx|ty)\b/gi,
];

/** Strip Slack mention tokens like <@U12345> and <@U12345|docloom>. */
export function stripMentions(text: string): string {
  return text.replace(/<@[^>]+>/g, " ");
}

export function extractQueryHeuristic(text: string): string {
  let query = stripMentions(text)
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const original = query;
  for (const pattern of FILLER_PATTERNS) {
    query = query.replace(pattern, " ");
  }
  query = query.replace(/\s+/g, " ").trim();

  // If we stripped everything meaningful, fall back to the raw text.
  if (query.length < 2) {
    query = original;
  }

  // Keep queries bounded.
  return query.split(" ").slice(0, 8).join(" ").slice(0, 100).trim();
}
