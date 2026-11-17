/**
 * The names of the panes a judgment flow starts, and what their names say about the flow (ADR 0121).
 * A name carries a letter before each ordinal, because `session spawn` refuses a bare number segment.
 */

/** The states a pane in the session registry can be read in, as the tick sees them. */
export type FlowState = "running" | "done" | "blocked" | "closed";

/** One pane of an idea, read from the session registry. */
export interface FlowPane {
  name: string;
  state: FlowState;
}

/** A judgment or retry pane: a decision the flow asked for, numbered in the order the flow made them. */
export interface Decision {
  ord: number;
  retry: boolean;
  pane: FlowPane;
}

/** The reader panes a decision's reads started. */
export interface ReadRound {
  ord: number;
  readers: FlowPane[];
}

/** What the registry says about one idea's judgment flow. */
export interface Flow {
  /** Judgment and retry panes, in ordinal order. */
  decisions: Decision[];
  /** The reader rounds, in ordinal order: one per decision that asked for reads. */
  rounds: ReadRound[];
  /** The read rounds taken so far, which the read limit counts. */
  readRounds: number;
  /** The retries started so far: each one follows a refused plan. */
  refusals: number;
  /** The ordinal the next judgment or retry pane takes. */
  nextOrd: number;
}

export const judgmentName = (idea: string, ord: number): string =>
  `idea-${idea}-judgment-r${ord}`;

export const retryName = (idea: string, ord: number): string =>
  `idea-${idea}-retry-r${ord}`;

export const readerName = (idea: string, ord: number, q: number): string =>
  `idea-${idea}-read-r${ord}-q${q}`;

/** Whether a pane has finished and is still open for the tick to consume or close. */
export const isFinished = (pane: FlowPane): boolean =>
  pane.state === "done" || pane.state === "blocked";

/** Whether a pane has not been closed yet. */
export const isOpen = (pane: FlowPane): boolean => pane.state !== "closed";

const DECISION = /^(judgment|retry)-r(\d+)$/;
const READER = /^read-r(\d+)-q\d+$/;

/** The flow the registry's panes for one idea describe. Pure: it reads names and states only. */
export function flowOf(idea: string, panes: readonly FlowPane[]): Flow {
  const prefix = `idea-${idea}-`;
  const decisions: Decision[] = [];
  const readers = new Map<number, FlowPane[]>();
  for (const pane of panes) {
    if (!pane.name.startsWith(prefix)) {
      continue;
    }
    const rest = pane.name.slice(prefix.length);
    const decision = DECISION.exec(rest);
    const reader = READER.exec(rest);
    if (decision?.[1] !== undefined && decision[2] !== undefined) {
      decisions.push({
        ord: Number(decision[2]),
        retry: decision[1] === "retry",
        pane,
      });
    } else if (reader?.[1] !== undefined) {
      const ord = Number(reader[1]);
      readers.set(ord, [...(readers.get(ord) ?? []), pane]);
    }
  }
  decisions.sort((a, b) => a.ord - b.ord);
  const rounds: ReadRound[] = [...readers.keys()]
    .sort((a, b) => a - b)
    .map((ord) => ({
      ord,
      readers: [...(readers.get(ord) ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, "en", { numeric: true }),
      ),
    }));
  const top = decisions.at(-1)?.ord ?? 0;
  return {
    decisions,
    rounds,
    readRounds: rounds.length,
    refusals: decisions.filter((d) => d.retry).length,
    nextOrd: top + 1,
  };
}
