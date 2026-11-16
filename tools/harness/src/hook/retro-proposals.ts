// What the retro scan proposes: unused skills and agents, and promotable audit
// rules, each as a ready command a person or the retro pane runs. Pure: it
// files, changes and enforces nothing.
// Docs: infra/plans/12-self-improving-loop.md (Step 2)

/** The least evidence "unused" rests on; shown in the scan output. */
export const MIN_DAYS = 14;
export const MIN_SESSIONS = 100;
export const EVIDENCE = { minDays: MIN_DAYS, minSessions: MIN_SESSIONS };

const HARNESS = "node skills/bin/harness.mjs";

export interface History {
  minDays: number;
  minSessions: number;
  days: number;
  sessions: number;
  sufficient: boolean;
}

export interface Proposal {
  kind: "unused-skill" | "unused-agent" | "promotable-rule";
  subject: string;
  command: string;
}

export interface ProposalInput {
  /** Sessions in the window. */
  sessions: number;
  /** Days of ledger behind the window. */
  days: number;
  skills: readonly string[];
  agents: readonly string[];
  promotable: readonly string[];
}

/** The known agents that no launch named, sorted. */
export function unusedAgents(
  known: readonly string[],
  launched: readonly string[],
): string[] {
  return known.filter((name) => !launched.includes(name)).sort();
}

function removal(noun: "skill" | "agent", name: string): string {
  return `${HARNESS} idea new --kind harness --title "Remove the unused ${noun} ${name}" --hypothesis "If the ${noun} ${name} is removed, the harness carries one less thing to maintain and no session misses it" --expected-outcome "No session ${noun === "skill" ? "loads" : "launches"} ${name} before or after; tokens per idea fall slightly" --measurement "metrics.tokensPerIdea in harness flow report, trailing window" --safety-pattern no-behaviour-change --metric metrics.tokensPerIdea --direction down --window ${MIN_DAYS}d`;
}

/**
 * Ready commands for what the scan found. Removals need the minimum days and
 * sessions; a promotable rule already passed its own evidence rule. A guardrail
 * request only asks: `guardrail activate` still needs a person.
 */
export function proposalsFor(input: ProposalInput): {
  history: History;
  proposals: Proposal[];
} {
  const history: History = {
    ...EVIDENCE,
    days: input.days,
    sessions: input.sessions,
    sufficient: input.days >= MIN_DAYS && input.sessions >= MIN_SESSIONS,
  };
  const proposals: Proposal[] = [];
  if (history.sufficient) {
    for (const name of input.skills) {
      proposals.push({
        kind: "unused-skill",
        subject: name,
        command: removal("skill", name),
      });
    }
    for (const name of input.agents) {
      proposals.push({
        kind: "unused-agent",
        subject: name,
        command: removal("agent", name),
      });
    }
  }
  for (const rule of input.promotable) {
    proposals.push({
      kind: "promotable-rule",
      subject: rule,
      command: `${HARNESS} guardrail request ${rule} --to enforce --idea <idea> --scan <retro-scan.json> --false-positives 0`,
    });
  }
  return { history, proposals };
}
