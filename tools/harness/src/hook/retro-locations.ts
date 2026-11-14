// The locations the retro scan reports per rule under --evidence: capped per
// rule, in the order added, and listed by rule name.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

/** How many locations one rule keeps; the counts still report every one. */
const EVIDENCE_CAP = 20;

/** Where one block or override is: its session, transcript line and excerpt. */
export interface Location {
  session: string;
  line: number;
  excerpt: string;
  /** Overridden bare-glob rows only: the unquoted glob the guard named. */
  glob?: string;
}

export class RuleLocations {
  private readonly byRule: Record<string, Location[]> = {};

  add(rule: string, location: Location): void {
    const locations = (this.byRule[rule] ??= []);
    if (locations.length < EVIDENCE_CAP) {
      locations.push(location);
    }
  }

  sorted(): Record<string, Location[]> {
    return Object.fromEntries(
      Object.entries(this.byRule).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
}
