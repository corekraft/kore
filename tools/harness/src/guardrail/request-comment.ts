// The comment that asks a person to approve a guardrail change, posted on the
// idea's issue (ADR 0080). A pure function of its input.
import type { Guardrail } from "./inventory.js";
import { direction, type Target } from "./requests.js";

interface Common {
  /** Where the figures start, and why. */
  window: string;
}

/** What each kind of rule has measured; the figures are counts, never a verdict. */
export type Evidence =
  | (Common & {
      source: "warnings";
      /** The retro-scan classification of the rule. */
      status: string;
      fired: number;
      heeded: number;
      overridden: number;
      repeated: number;
      unresolved: number;
    })
  | (Common & { source: "blocks"; blocks: number })
  | (Common & {
      source: "ruleset-insights";
      ruleset: string;
      timePeriod: string;
      suites: number;
      firings: number;
      truncated: boolean;
    });

export interface RequestComment {
  guardrail: Guardrail;
  to: Target;
  /** The ledger event that recorded this request; a new request has a new marker. */
  requestId: string;
  idea: { number: string; title: string; path: string; link: string };
  evidence: Evidence;
}

/** The hidden line a rerun looks for, so one request is posted once. */
export const marker = (requestId: string): string =>
  `<!-- guardrail-request: ${requestId} -->`;

function figures(evidence: Evidence): string[] {
  if (evidence.source === "warnings") {
    return [
      "| Fired | Heeded | Overridden | Repeated (identical call) | Unresolved |",
      "| --- | --- | --- | --- | --- |",
      `| ${evidence.fired} | ${evidence.heeded} | ${evidence.overridden} | ${evidence.repeated} | ${evidence.unresolved} |`,
      "",
      "Fired is how often the rule warned in audit mode; the other four add up to it. Heeded: the agent changed course. Overridden: a person continued past it. Repeated: the agent made the identical call again. Unresolved: nothing followed.",
      "",
      `Classification: ${evidence.status}`,
    ];
  }
  if (evidence.source === "blocks") {
    return [
      "| Blocked |",
      "| --- |",
      `| ${evidence.blocks} |`,
      "",
      "Blocked is how often the rule stopped a tool call in the session transcripts of the window. It does not say whether the call was legitimate.",
    ];
  }
  return [
    "| Suites evaluated | Would have blocked |",
    "| --- | --- |",
    `| ${evidence.suites} | ${evidence.firings}${evidence.truncated ? "+" : ""} |`,
    "",
    `From \`harness ruleset insights\` on \`${evidence.ruleset}\`, over the last ${evidence.timePeriod}.${evidence.truncated ? " The period held more suites than one page, so the counts are a floor." : ""}`,
  ];
}

export function renderRequest({
  guardrail,
  to,
  requestId,
  idea,
  evidence,
}: RequestComment): string {
  const goal = to === "remove" ? "removed" : to;
  const { rule } = guardrail;
  return [
    marker(requestId),
    `## Approval requested: ${direction(to).toLowerCase()} guardrail \`${rule}\``,
    "",
    `Idea ${idea.number}: [${idea.title}](${idea.link}) (\`${idea.path}\`)`,
    "",
    `Change: \`${rule}\` ${guardrail.mode} → ${goal} (${guardrail.kind}, owner \`${guardrail.owner}\`). ${direction(to)}.`,
    "",
    `### Outcome summary (${evidence.window})`,
    "",
    ...figures(evidence),
    "",
    "### For the approving person",
    "",
    "- [ ] I judged whether the firings above hit legitimate work. Whether a firing was a false positive is a person's judgement; the figures do not decide it (ADR 0080).",
    `- [ ] If I approve, I edit the rule's \`mode\` in \`.claude/guardrails.yaml\`. This request changes no guardrail.`,
    "",
  ].join("\n");
}
