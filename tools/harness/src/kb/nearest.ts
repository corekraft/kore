// The candidate nearest a word a document names wrongly, by edit distance: the "did you mean" of kb-check.

/** The number of single-character edits that turn one string into the other. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        substitution,
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** The candidate nearest the word; the earlier one wins a tie, and undefined means there is none. */
export function nearest(
  word: string,
  candidates: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const near = distance(word, candidate);
    if (near < bestDistance) {
      best = candidate;
      bestDistance = near;
    }
  }
  return best;
}
