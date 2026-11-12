// The `main` ruleset as the repository declares it, and the plan that brings
// GitHub's live copy to it. Enforcement is not declared: the guardrail
// inventory's mode for `main-ruleset` decides it (ADR 0080).
// Plan: infra/plans/12-self-improving-loop.md (Step 4).

import type { Mode } from "../guardrail/index.js";

export const RULE = "main-ruleset";
export const DECLARED_DIR = ".github/rulesets";

export class RulesetError extends Error {}

export type Enforcement = "evaluate" | "active";
type Json = Record<string, unknown>;

/** Audit rules sync as GitHub's `evaluate`; only enforce rules sync as `active`. */
export function enforcementFor(mode: Mode): Enforcement {
  return mode === "audit" ? "evaluate" : "active";
}

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

export interface Plan {
  action: "create" | "update" | "none";
  /** The live ruleset id, when there is one. */
  id?: number;
  from?: string;
  enforcement: Enforcement;
  /** Declared fields whose live value differs, besides enforcement. */
  changed: string[];
  body: Json;
}

export function plan(declared: Json, mode: Mode, live: Json | undefined): Plan {
  const enforcement = enforcementFor(mode);
  const body = { ...declared, enforcement };
  if (live === undefined) {
    return { action: "create", enforcement, changed: [], body };
  }
  const changed = Object.entries(declared)
    .filter(([key, want]) => !covers(want, live[key]))
    .map(([key]) => key);
  const from =
    typeof live["enforcement"] === "string" ? live["enforcement"] : "unknown";
  const id = live["id"];
  if (typeof id !== "number") {
    throw new RulesetError(
      `GitHub returned the live ruleset ${String(declared["name"])} without a numeric id, so it cannot be updated. Check it in the repository settings, then rerun.`,
    );
  }
  const action =
    changed.length === 0 && from === enforcement ? "none" : "update";
  return { action, id, from, enforcement, changed, body };
}
