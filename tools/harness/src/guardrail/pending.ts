// Requests still waiting for a person: the latest guardrail.requested event per
// rule, while the rule still has the mode the request would change.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).

import type { Inventory } from "./inventory.js";

export interface PendingRequest {
  rule: string;
  from: string;
  to: string;
  idea: string;
}

const LABEL = /^([a-z0-9-]+):(audit|enforce)>(audit|enforce|removed)$/;

/** Pending requests in the order their rules were last requested. */
export function pendingRequests(
  events: readonly { label?: string; idea?: string }[],
  inventory: Inventory,
): PendingRequest[] {
  const latest = new Map<string, PendingRequest>();
  for (const { label, idea } of events) {
    const [, rule, from, to] = LABEL.exec(label ?? "") ?? [];
    if (rule !== undefined && from !== undefined && to !== undefined && idea) {
      latest.delete(rule);
      latest.set(rule, { rule, from, to, idea });
    }
  }
  return [...latest.values()].filter((request) => {
    const current = inventory.guardrails.find((g) => g.rule === request.rule);
    return current?.mode === request.from;
  });
}
