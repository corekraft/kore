// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md

import type { ManifestEntry } from "./manifest.js";
import { FLAG_MANIFEST } from "./requirements.js";

const DAY_MS = 86_400_000;

/** What the retirement reads about one environment the flag applies to (ADR 0149). */
export interface RetireEnvironment {
  name: string;
  /** Whether the environment has an overlay that can hold the flag. */
  hasOverlay: boolean;
  /** Whether the overlay turns the flag on. */
  on: boolean;
  /** Whether the flag has a recorded outcome in this environment: a live run, or a waiver where one counts. */
  proven: boolean;
  /** When the latest flag.activated event for the flag in this environment was recorded, if one was. */
  activated: string | undefined;
}

/** The facts an eligibility verdict is read from. Plain data, so the rule is tested without the ledger. */
export interface RetireFacts {
  flag: string;
  /** The flag's manifest entry, or undefined when the manifest does not declare it. */
  entry: ManifestEntry | undefined;
  environments: RetireEnvironment[];
  /** When each revert event was recorded: a main revert or a harness change revert. */
  reverts: string[];
  /** The soak length the manifest configures, in whole days. */
  soakDays: number;
  now: Date;
}

/** The environments a flag's entry lists as applicable: its applies, minus its not-applicable marks (ADR 0148). */
export function retirementEnvironments(entry: ManifestEntry): string[] {
  return entry.applies.filter((name) => !entry.notApplicable.includes(name));
}

/** The reasons a flag is not eligible to retire; none means it is, and every refusal is named. */
export function retireRefusals(facts: RetireFacts): string[] {
  const { entry, flag } = facts;
  if (entry === undefined) {
    return [
      `${flag} is not declared in ${FLAG_MANIFEST}, so it has no entry to retire`,
    ];
  }
  if (entry.kind !== "feature") {
    return [
      `${flag} is a ${entry.kind} flag; only a feature flag retires (ADR 0149)`,
    ];
  }
  const names = retirementEnvironments(entry);
  if (names.length === 0) {
    return [
      `${flag} applies to no environment, so nothing shows it has soaked`,
    ];
  }
  const reasons: string[] = [];
  const activations: number[] = [];
  for (const name of names) {
    const env = facts.environments.find((e) => e.name === name);
    reasons.push(...environmentRefusals(flag, name, env));
    if (env?.activated !== undefined) {
      activations.push(Date.parse(env.activated));
    }
  }
  if (activations.length === names.length) {
    reasons.push(...soakRefusals(facts, Math.max(...activations)));
  }
  return reasons;
}

/** The refusals one environment the flag applies to adds: no overlay, off, no outcome, or no activation. */
function environmentRefusals(
  flag: string,
  name: string,
  env: RetireEnvironment | undefined,
): string[] {
  if (env === undefined || !env.hasOverlay) {
    return [`${name} has no environment overlay to read ${flag} from`];
  }
  const reasons: string[] = [];
  if (!env.on) {
    reasons.push(`${flag} is off in ${name}`);
  }
  if (!env.proven) {
    reasons.push(`${flag} has no recorded outcome in ${name}`);
  }
  if (env.activated === undefined) {
    reasons.push(`${flag} has no recorded activation in ${name}`);
  }
  return reasons;
}

/** The refusals that rest on the soak after the latest activation: it has not elapsed, or a revert fell inside it. */
function soakRefusals(facts: RetireFacts, latest: number): string[] {
  const since = new Date(latest).toISOString();
  const ends = latest + facts.soakDays * DAY_MS;
  const reasons: string[] = [];
  if (facts.now.getTime() < ends) {
    reasons.push(
      `the soak after ${since} ends ${new Date(ends).toISOString()} and has not elapsed`,
    );
  }
  for (const reverted of facts.reverts) {
    if (Date.parse(reverted) >= latest) {
      reasons.push(
        `a revert was recorded at ${reverted}, inside the soak after ${since}`,
      );
    }
  }
  return reasons;
}
