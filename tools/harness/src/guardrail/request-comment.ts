// The comment that asks a person to approve a guardrail change, posted on the
// idea's issue (ADR 0080). A pure function of its input.
import type { Guardrail } from "./inventory.js";
import { direction, requestLabel, type Target } from "./requests.js";

/** One rule's retro-scan row; the four figures are derived from it. */
export interface Evidence {
  status: string;
  warnings: number;
  heeded: number;
  overridden: number;
  /** The agent repeated the identical call after the warning: the warning did not apply. */
  repeated: number;
}

export interface RequestComment {
  guardrail: Guardrail;
  to: Target;
  idea: { number: string; title: string; path: string; link: string };
  evidence: Evidence;
}

/** The hidden line a rerun looks for, so one request is posted once. */
export const marker = (rule: string, to: Target): string =>
  `<!-- guardrail-request: ${requestLabel(rule, to)} -->`;

export function renderRequest({
  guardrail,
  to,
  idea,
  evidence,
}: RequestComment): string {
  const goal = to === "remove" ? "removed" : to;
  const { rule } = guardrail;
  return [
    marker(rule, to),
    `## Approval requested: ${direction(to).toLowerCase()} guardrail \`${rule}\``,
    "",
    `Idea ${idea.number}: [${idea.title}](${idea.link}) (\`${idea.path}\`)`,
    "",
    `Change: \`${rule}\` ${guardrail.mode} → ${goal} (${guardrail.kind}, owner \`${guardrail.owner}\`). ${direction(to)}.`,
    "",
    "### Outcome summary",
    "",
    "| Fired | Heeded | Overridden | False positives |",
    "| --- | --- | --- | --- |",
    `| ${evidence.warnings} | ${evidence.heeded} | ${evidence.overridden} | ${evidence.repeated} |`,
    "",
    `Classification: ${evidence.status}`,
    "",
    "Fired is how often the rule warned in audit mode. Heeded: the agent changed course. Overridden: a person continued past it. False positives: the agent repeated the identical call, so the warning did not apply.",
    "",
    `Nothing changes until a person approves: edit the rule's \`mode\` in \`.claude/guardrails.yaml\` (ADR 0080). This request changes no guardrail.`,
    "",
  ].join("\n");
}
