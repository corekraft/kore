// The span printed beside an idea's share of one week's ceiling (#1048): the seconds from the first
// event stamped with the idea to the last, so a size is never read as a rate.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";

/** The seconds from an idea's first event to its last; null where no event is stamped with it. */
export function ideaSpanSeconds(
  events: LedgerEvent[],
  idea: string,
): number | null {
  const times = events.filter((e) => e.idea === idea).map(time);
  if (times.length === 0) {
    return null;
  }
  return (Math.max(...times) - Math.min(...times)) / 1000;
}
