/**
 * ZClaw Gateway — Semantic Scorer
 *
 * Keyword-based relevance scoring for tool injection.
 * Zero dependencies, deterministic, fast.
 */

export function scoreRelevance(query: string, text: string): number {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 1);
  const target = text.toLowerCase();
  return words.reduce((score, word) => score + (target.includes(word) ? 1 : 0), 0);
}
