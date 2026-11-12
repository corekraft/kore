// The `main` ruleset as the repository declares it, and the plans that bring
// GitHub's live copies to it. Main stays `active` permanently. Each declared
// rule has a guardrail inventory mode: an enforce rule belongs to main; an
// audit rule syncs into a separate candidate ruleset in `evaluate`, and
// promotion moves it into main (ADR 0090, refining ADR 0080).
// Plan: infra/plans/12-self-improving-loop.md (Step 4).

import type { Mode } from "../guardrail/index.js";

export const DECLARED_DIR = ".github/rulesets";

export class RulesetError extends Error {}

export type Json = Record<string, unknown>;

/** The candidate ruleset that holds a target's audit rules in evaluate mode. */
export const candidateName = (target: string): string => `${target}-candidate`;

/** The inventory rule that gives one ruleset rule its mode, such as main-ruleset-required-status-checks. */
export const ruleName = (target: string, type: string): string =>
  `${target}-ruleset-${type.replaceAll("_", "-")}`;

export function parseDeclared(path: string, text: string): Json {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const body = value as Json;
      if (typeof body["name"] === "string" && Array.isArray(body["rules"])) {
        return body;
      }
    }
  } catch {
    // Falls through to the actionable error below.
  }
  throw new RulesetError(
    `${path} must be a JSON object with a "name" and a "rules" list. Fix the file, then rerun.`,
  );
}

const rulesOf = (body: Json): Json[] => (body["rules"] as Json[]) ?? [];
const typeOf = (rule: Json): string => String(rule["type"]);
export const typesOf = (rules: readonly Json[]): string[] => rules.map(typeOf);

export interface Staged {
  /** The rules main holds after the sync: live versions kept, promoted versions swapped in. */
  main: Json[];
  /** The rules the candidate holds after the sync, in evaluate. */
  candidate: Json[];
  /** Enforce rules that changed or are new, waiting in the candidate to be observed before they reach main. */
  pending: string[];
}

/**
 * Decides, rule by rule, where the declared version goes. Main keeps its live
 * version of a rule until the candidate has held the declared one, so a new or
 * changed rule is observed before it blocks (ADR 0090): an audit rule always
 * waits in the candidate; an enforce rule that differs from main waits there
 * too, and moves to main on the sync after the candidate holds it. Without a
 * live main there is nothing to protect or compare, so main starts from the
 * enforce rules.
 */
export function stage(
  declared: Json,
  modeOf: (type: string) => Mode,
  main: Json | undefined,
  candidate: Json | undefined,
): Staged {
  const liveMain = new Map(rulesOf(main ?? {}).map((r) => [typeOf(r), r]));
  const liveCandidate = new Map(
    rulesOf(candidate ?? {}).map((r) => [typeOf(r), r]),
  );
  const staged: Staged = { main: [], candidate: [], pending: [] };
  for (const rule of rulesOf(declared)) {
    const type = typeOf(rule);
    const params = rule["parameters"] ?? {};
    const there = liveMain.get(type);
    const held = liveCandidate.get(type);
    const observed = held !== undefined && covers(params, held["parameters"]);
    if (modeOf(type) === "enforce" && main === undefined) {
      staged.main.push(rule);
    } else if (
      modeOf(type) === "enforce" &&
      there &&
      covers(params, there["parameters"])
    ) {
      staged.main.push(there);
    } else if (modeOf(type) === "enforce" && observed) {
      staged.main.push(rule);
    } else {
      staged.candidate.push(rule);
      if (modeOf(type) === "enforce") {
        staged.pending.push(type);
      }
      if (there !== undefined) {
        staged.main.push(there);
      }
    }
  }
  return staged;
}

/** Every declared key and element is present and equal in live; GitHub's extra fields are ignored. */
function covers(want: unknown, have: unknown): boolean {
  if (Array.isArray(want)) {
    return (
      Array.isArray(have) &&
      want.length === have.length &&
      want.every((w, i) => covers(w, have[i]))
    );
  }
  if (typeof want === "object" && want !== null) {
    const live =
      typeof have === "object" && have !== null ? (have as Json) : {};
    return Object.entries(want).every(([k, w]) => covers(w, live[k]));
  }
  return want === have;
}

/** Rule types whose declared parameters differ live; the order GitHub lists rules in is ignored. */
function changedRules(want: readonly Json[], have: readonly Json[]): string[] {
  const live = new Map(have.map((r) => [typeOf(r), r]));
  return want
    .filter((w) => {
      const there = live.get(typeOf(w));
      return (
        there !== undefined &&
        !covers(w["parameters"] ?? {}, there["parameters"])
      );
    })
    .map(typeOf);
}

const idOf = (live: Json, name: string): number => {
  if (typeof live["id"] !== "number") {
    throw new RulesetError(
      `GitHub returned the live ruleset ${name} without a numeric id, so it cannot be updated. Check it in the repository settings, then rerun.`,
    );
  }
  return live["id"];
};

const enforcementOf = (live: Json): string =>
  typeof live["enforcement"] === "string" ? live["enforcement"] : "unknown";

export interface MainPlan {
  action: "create" | "update" | "none";
  id?: number;
  from?: string;
  enforcement: "active";
  /** Rule types main gains. */
  added: string[];
  /** Rule types live main has that the file does not declare; removing one weakens main. */
  removed: string[];
  /** Parameters, conditions or bypass actors the file makes weaker than live main. */
  weakened: string[];
  /** Enforce rules waiting in the candidate before they reach main. */
  pending: string[];
  /** Declared fields or rule parameters that differ live. */
  changed: string[];
  body: Json;
}

/** Main always syncs as active, with the rules staging leaves it. */
export function planMain(
  declared: Json,
  staged: Staged,
  live: Json | undefined,
): MainPlan {
  const body = { ...declared, rules: staged.main, enforcement: "active" };
  const want = typesOf(staged.main);
  const none = { weakened: [], pending: staged.pending };
  if (live === undefined) {
    return {
      action: "create",
      enforcement: "active",
      added: want,
      removed: [],
      changed: [],
      body,
      ...none,
    };
  }
  const have = typesOf(rulesOf(live));
  const fields = Object.entries(declared)
    .filter(([key, value]) => key !== "rules" && !covers(value, live[key]))
    .map(([key]) => key);
  const changed = [...fields, ...changedRules(staged.main, rulesOf(live))];
  const added = want.filter((t) => !have.includes(t));
  const removed = have.filter((t) => !typesOf(rulesOf(declared)).includes(t));
  const from = enforcementOf(live);
  const unchanged =
    changed.length + added.length + removed.length === 0 && from === "active";
  return {
    action: unchanged ? "none" : "update",
    id: idOf(live, String(declared["name"])),
    from,
    enforcement: "active",
    added,
    removed,
    changed,
    body,
    ...none,
  };
}

export interface CandidatePlan {
  name: string;
  action: "create" | "update" | "none";
  id?: number;
  enforcement: "evaluate";
  /** The rule types the candidate holds after the sync. */
  rules: string[];
  body: Json;
}

/** The candidate holds the staged rules in evaluate; it is never created just to be empty. */
export function planCandidate(
  declared: Json,
  audited: Json[],
  live: Json | undefined,
): CandidatePlan {
  const name = candidateName(String(declared["name"]));
  const body = { ...declared, name, rules: audited, enforcement: "evaluate" };
  const base = {
    name,
    enforcement: "evaluate" as const,
    rules: typesOf(audited),
    body,
  };
  if (live === undefined) {
    return { ...base, action: audited.length === 0 ? "none" : "create" };
  }
  const sameRules =
    typesOf(rulesOf(live)).join() === typesOf(audited).join() &&
    changedRules(audited, rulesOf(live)).length === 0;
  const sameFields = Object.entries(declared)
    .filter(([key]) => !["rules", "name"].includes(key))
    .every(([key, value]) => covers(value, live[key]));
  const unchanged =
    sameRules && sameFields && enforcementOf(live) === "evaluate";
  return {
    ...base,
    action: unchanged ? "none" : "update",
    id: idOf(live, name),
  };
}
