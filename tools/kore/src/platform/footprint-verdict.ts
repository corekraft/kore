// Docs: infra/plans/15-next-horizon.md (the footprint breach and its ladder)
//
// The breach verdict of a footprint run (#1107). A run that swamps the 16 GB
// host is recorded inconclusive, never as a pass or a fail. The owner decided
// the rule on 2026-11-17: a run breaches when memory in use goes above 85
// percent of the Docker VM at any sample (under 15 percent free at the peak),
// or when any pod's last state was OOMKilled during the run. Swap is not part
// of the rule: the clean baseline already sat at about 4.7 GiB of host swap.

/** Memory in use above this share of the Docker VM is a breach. */
export const footprintBreachCeilingPercent = 85;

export type FootprintBreach =
  | {
      rule: "memory";
      /** The peak memory in use, as a percent of the Docker VM, to one decimal. */
      usedPercentAtPeak: number;
      ceilingPercent: number;
    }
  | {
      rule: "oomkilled";
      /** Each pod whose last state was OOMKilled, as `namespace/name`. */
      pods: string[];
    };

export interface FootprintVerdict {
  breached: boolean;
  /** Each rule that tripped, memory first; empty for a clean run. */
  breaches: FootprintBreach[];
}

export interface FootprintVerdictInput {
  /** The peak memory in use across the samples, in MiB. */
  peakMemoryMiB: number;
  /** The Docker VM's total memory, in MiB. */
  vmMemoryMiB: number;
  /** Pods whose last state was OOMKilled during the run, as `namespace/name`. */
  oomKilledPods: string[];
}

/** Judges one run against the breach rule; the caller reads the figures. */
export function judgeFootprint(input: FootprintVerdictInput): FootprintVerdict {
  const breaches: FootprintBreach[] = [];
  // Compared in integers so that exactly 85 percent is never a breach.
  if (
    input.peakMemoryMiB * 100 >
    footprintBreachCeilingPercent * input.vmMemoryMiB
  ) {
    breaches.push({
      rule: "memory",
      usedPercentAtPeak:
        Math.round((input.peakMemoryMiB / input.vmMemoryMiB) * 1000) / 10,
      ceilingPercent: footprintBreachCeilingPercent,
    });
  }
  if (input.oomKilledPods.length > 0) {
    breaches.push({ rule: "oomkilled", pods: [...input.oomKilledPods] });
  }
  return { breached: breaches.length > 0, breaches };
}
