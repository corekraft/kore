/** The fields of a session record the reconcile reads; a SessionRecord carries every one of them. */
export interface RecordFacts {
  name: string;
  /** Absent means herdr. */
  backend?: string;
  terminal?: string;
  starting?: boolean;
  closedAt?: string;
  result?: unknown;
  reportSeq?: number;
  worktree?: { path: string };
}

/** An hc session the record shows as started and not yet settled (plan 16, Grilled Decisions 10). */
export interface Unsettled {
  name: string;
  terminal: string;
  /** The seq of the last report the wait consumed; 0 when none has been. */
  reportSeq: number;
  /** The worktree a writer runs in, which is where its report is written. */
  worktree?: string;
}

/**
 * The hc records that are open, name a terminal and have no result yet. A herdr record is
 * left out, and so is a record still starting, since its own start settles it.
 */
export function unsettledOf(records: readonly RecordFacts[]): Unsettled[] {
  return records.flatMap((record) => {
    if (
      record.backend !== "hc" ||
      record.closedAt !== undefined ||
      record.result !== undefined ||
      record.starting === true ||
      record.terminal === undefined
    ) {
      return [];
    }
    return [
      {
        name: record.name,
        terminal: record.terminal,
        reportSeq: record.reportSeq ?? 0,
        ...(record.worktree === undefined
          ? {}
          : { worktree: record.worktree.path }),
      },
    ];
  });
}
