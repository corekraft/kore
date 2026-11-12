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
  to: Target;
  idea: string;
  requestedAt: string;
}

/** The part of a ledger event a request needs. */
export interface RequestEvent {
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

/** Whether the inventory already holds what the request asked for. */
function reached(guardrail: Guardrail, to: Target): boolean {
  return to !== "remove" && guardrail.mode === to;
}

/** Tightening moves a rule to enforce; anything else loosens it. */
export const direction = (to: Target): "Tightening" | "Loosening" =>
  to === "enforce" ? "Tightening" : "Loosening";

/** The pending request per rule: its latest, unless the inventory already holds it. */
export function pendingRequests(
  inventory: Inventory,
  events: readonly RequestEvent[],
): Map<string, Pending> {
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
        to: parsed.to,
        idea: event.idea ?? "",
        requestedAt: event.occurredAt,
      });
    }
  }
  for (const guardrail of inventory.guardrails) {
    const pending = latest.get(guardrail.rule);
    if (pending !== undefined && reached(guardrail, pending.to)) {
      latest.delete(guardrail.rule);
    }
  }
  const listed = new Set(inventory.guardrails.map((g) => g.rule));
  for (const rule of latest.keys()) {
    if (!listed.has(rule)) {
      latest.delete(rule);
    }
  }
  return latest;
}
