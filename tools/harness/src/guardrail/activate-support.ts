// Fixtures for the activation specs: a fake set of ports and the comments an approval is read from.
import { vi } from "vitest";
import {
  GuardrailActivate,
  approvalLine,
  type ActivatePorts,
  type IssueComment,
} from "./activate.js";
import type { Guardrail, Inventory } from "./inventory.js";

export const IDEA = {
  number: "0224",
  title: "Guardrail activation",
  path: "docs/ideas/0224-guardrail-activation.md",
  issue: "224",
};
export const REQUEST_AT = "2026-11-14T10:00:00Z";
export const LATER = "2026-11-14T11:00:00Z";

export const GUARDRAILS: Record<string, Guardrail> = {
  guard: { rule: "bare-glob", kind: "bash", mode: "audit", owner: "o" },
  deny: {
    rule: "deny-x",
    kind: "bash",
    mode: "audit",
    owner: "o",
    deny: ["Bash(x:*)"],
  },
  judge: { rule: "judge-ci", kind: "checklist", mode: "audit", owner: "o" },
  "merge gate": {
    rule: "judge-pattern-match",
    kind: "checklist",
    mode: "audit",
    owner: "o",
  },
  ruleset: {
    rule: "main-ruleset-deletion",
    kind: "ruleset",
    mode: "audit",
    owner: "o",
  },
};
export const enforced: Guardrail = {
  rule: "no-verify",
  kind: "bash",
  mode: "enforce",
  owner: "o",
};

export const requestBody = (label: string): string =>
  `<!-- guardrail-request: ${label} -->\n### Request`;
export const person = (label: string, at = LATER, author = "junners") => ({
  author,
  createdAt: at,
  body: `Looks right.\n${approvalLine(label)}\n`,
});

export function fake(
  target: Guardrail,
  comments: (label: string) => IssueComment[],
  to = "enforce",
  labels: string[] = [],
) {
  const from = target.mode;
  const label = `${target.rule}:${from}>${to}`;
  const inventory: Inventory = { guardrails: [target] };
  const events = vi
    .fn<ActivatePorts["events"]>()
    .mockResolvedValue([{ label }]);
  const list = vi
    .fn<ActivatePorts["comments"]>()
    .mockResolvedValue(comments(label));
  const commentOn = vi
    .fn<ActivatePorts["comment"]>()
    .mockResolvedValue("https://github.com/o/r/issues/224#c9");
  const writeInventory = vi
    .fn<ActivatePorts["writeInventory"]>()
    .mockResolvedValue(undefined);
  const syncDeny = vi
    .fn<ActivatePorts["syncDeny"]>()
    .mockResolvedValue(undefined);
  const recordEvent = vi
    .fn<ActivatePorts["recordEvent"]>()
    .mockResolvedValue({ ok: true });
  const ports: ActivatePorts = {
    inventory,
    inventoryText: "INVENTORY",
    idea: IDEA,
    approvers: ["junners"],
    events,
    comments: list,
    labels: vi.fn<ActivatePorts["labels"]>().mockResolvedValue(labels),
    comment: commentOn,
    writeInventory,
    syncDeny,
    recordEvent,
  };
  return {
    activate: new GuardrailActivate(ports),
    label,
    writeInventory,
    syncDeny,
    recordEvent,
    commentOn,
    events,
  };
}

export const approved = (label: string): IssueComment[] => [
  { author: "claude", createdAt: REQUEST_AT, body: requestBody(label) },
  person(label),
];
