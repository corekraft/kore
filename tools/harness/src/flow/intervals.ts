export type Span = [number, number];

/** The part of `span` outside every span in `holes`, summed in milliseconds. */
export function uncovered(span: Span, holes: Span[]): number {
  const sorted = holes
    .map(([a, b]): Span => [Math.max(a, span[0]), Math.min(b, span[1])])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let free = span[1] - span[0];
  let reached = span[0];
  for (const [a, b] of sorted) {
    const from = Math.max(a, reached);
    if (b > from) {
      free -= b - from;
      reached = b;
    }
  }
  return free;
}
