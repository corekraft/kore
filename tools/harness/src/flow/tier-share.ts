import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** One role's launches by where their tier came from. */
export interface TierShare {
  role: string;
  launches: number;
  definition: number;
  escalation: number;
  override: number;
  /** Launches from before the tier source was recorded; never backfilled. */
  unknown: number;
  /** Overrides over the launches that know their source; null when none do. */
  overrideShare: number | null;
}

/** Launches per role by tier source, roles in name order, so tier tuning can read only definition and escalation launches. */
export function tierShares(events: LedgerEvent[], window: Span): TierShare[] {
  const byRole = new Map<string, TierShare>();
  for (const e of events) {
    if (
      e.kind !== "session.launch" ||
      e.role === undefined ||
      !inWindow(window, time(e))
    ) {
      continue;
    }
    const share = byRole.get(e.role) ?? {
      role: e.role,
      launches: 0,
      definition: 0,
      escalation: 0,
      override: 0,
      unknown: 0,
      overrideShare: null,
    };
    share.launches += 1;
    share[e.tierSource ?? "unknown"] += 1;
    byRole.set(e.role, share);
  }
  return [...byRole.values()]
    .map((s) => {
      const known = s.launches - s.unknown;
      return {
        ...s,
        overrideShare: known === 0 ? null : s.override / known,
      };
    })
    .sort((a, b) => a.role.localeCompare(b.role));
}
