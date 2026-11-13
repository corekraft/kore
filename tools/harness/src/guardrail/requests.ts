// Requests for a person to approve a guardrail mode change (ADR 0080). A
// request is a ledger event; it stays pending until the inventory holds the
// requested state, so nothing is stored beside the ledger and the inventory.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import type { Guardrail, Inventory } from "./inventory.js";

export const REQUEST_KIND = "guardrail.request";

/** The state a request asks for: a mode, or the rule's removal. */
export const TARGETS = ["enforce", "audit", "remove"] as const;
export type Target = (typeof TARGETS)[number];

export interface Pending {
  /** The ledger event that recorded the request. */
  id: string;
  to: Target;
  idea: string;
  requestedAt: string;
}

/** The part of a ledger event a request needs. */
export interface RequestEvent {
  id: string;
  kind: string;
  idea?: string | undefined;
  label?: string | undefined;
  occurredAt: string;
}

export const isTarget = (value: string): value is Target =>
  (TARGETS as readonly string[]).includes(value);

export const requestLabel = (rule: string, to: Target): string =>
  `${rule}:${to}`;

function parseLabel(label: string): { rule: string; to: Target } | undefined {
  const at = label.lastIndexOf(":");
  const to = label.slice(at + 1);
  return at > 0 && isTarget(to) ? { rule: label.slice(0, at), to } : undefined;
}

/** Whether the inventory file as it stands holds what the request asked for. */
function holds(guardrail: Guardrail | undefined, to: Target): boolean {
  return to === "remove" ? guardrail === undefined : guardrail?.mode === to;
}

/** Whether a commit after the request held the requested state. */
export type Reached = (
  rule: string,
  to: Target,
  since: string,
) => Promise<boolean>;

/** Tightening moves a rule to enforce; anything else loosens it. */
export const direction = (to: Target): "Tightening" | "Loosening" =>
  to === "enforce" ? "Tightening" : "Loosening";

/** The latest request per rule. */
function latestRequests(events: readonly RequestEvent[]): Map<string, Pending> {
  const latest = new Map<string, Pending>();
  for (const event of [...events].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  )) {
    const parsed =
      event.kind === REQUEST_KIND && event.label !== undefined
        ? parseLabel(event.label)
        : undefined;
    if (parsed !== undefined) {
      latest.set(parsed.rule, {
        id: event.id,
        to: parsed.to,
        idea: event.idea ?? "",
        requestedAt: event.occurredAt,
      });
    }
  }
  return latest;
}

/**
 * The requests still waiting for a person: each rule's latest, unless the
 * inventory holds its target now or a commit after the request did. Asking git
 * means a rule approved and later reverted is not pending again, and a new
 * request for it is a new request. A rule the inventory no longer lists has
 * nothing left to approve, unless the request was its removal and it is not
 * yet gone.
 */
export async function pendingRequests(
  inventory: Inventory,
  events: readonly RequestEvent[],
  reached: Reached,
): Promise<Map<string, Pending>> {
  const waiting = new Map<string, Pending>();
  for (const [rule, request] of latestRequests(events)) {
    const guardrail = inventory.guardrails.find((g) => g.rule === rule);
    if (
      guardrail !== undefined &&
      !holds(guardrail, request.to) &&
      !(await reached(rule, request.to, request.requestedAt))
    ) {
      waiting.set(rule, request);
    }
  }
  return waiting;
}
