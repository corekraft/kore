// The RESULT marker a Claude turn may end with (#853): the outcome word the Stop hook records as session.result.
// Only transcripts are read with it. No session is settled by a marker: a session settles on its report (ADR 0178).

const MARKER = /^[ \t]*(?:[●⏺][ \t]+)?RESULT: (done|blocked)[ \t\r]*$/gm;

/** The outcome word of the last anchored marker line, or undefined when there is none. */
export function findResult(text: string): "done" | "blocked" | undefined {
  const last = [...text.matchAll(MARKER)].at(-1)?.[1];
  return last === "done" || last === "blocked" ? last : undefined;
}
