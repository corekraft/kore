import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** Qualifier warnings in the range, the ideas filed in it, and warnings per idea filed (#866). */
export interface QualifierWarnings {
  /** qualifier.warned events in the range: a guard metric or a shared primary each. */
  warnings: number;
  /** idea.filed events in the range. */
  filed: number;
  /** warnings over filed, to four places; null when no idea was filed, never zero for that. */
  perFiled: number | null;
}

/** How many ideas the qualifier warned about against how many were filed, so a check that only warns still has a figure. */
export function qualifierWarnings(
  events: LedgerEvent[],
  window: Span,
): QualifierWarnings {
  const inRange = events.filter((e) => inWindow(window, time(e)));
  const warnings = inRange.filter((e) => e.kind === "qualifier.warned").length;
  const filed = inRange.filter((e) => e.kind === "idea.filed").length;
  return {
    warnings,
    filed,
    perFiled:
      filed === 0 ? null : Math.round((warnings / filed) * 10_000) / 10_000,
  };
}
