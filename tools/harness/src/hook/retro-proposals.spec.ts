// The retro scan's proposals as a unit: pure inputs in, ready commands out.
// Nothing here files, changes or enforces anything.
// Docs: infra/plans/12-self-improving-loop.md (Step 2)

import { describe, expect, it } from "vitest";
import {
  EVIDENCE,
  MIN_DAYS,
  MIN_SESSIONS,
  unusedAgents,
  proposalsFor,
} from "./retro-proposals.js";

const enough = { sessions: 100, days: 14 };
const none = { skills: [], agents: [], promotable: [] };

describe("the evidence constants", () => {
  it("name the window and the minimums in one place", () => {
    expect(MIN_DAYS).toBe(14);
    expect(MIN_SESSIONS).toBe(100);
    expect(EVIDENCE).toEqual({ minDays: 14, minSessions: 100 });
  });
});

describe("unusedAgents: agents with zero launches", () => {
  it("lists the known agents no launch named, sorted", () => {
    expect(
      unusedAgents(["writer", "judge", "refiner", "challenger"], ["writer"]),
    ).toEqual(["challenger", "judge", "refiner"]);
  });
});

describe("proposalsFor: enough history", () => {
  it("prints a ready idea command for each unused skill and agent", () => {
    const out = proposalsFor({
      ...enough,
      skills: ["handoff"],
      agents: ["refiner"],
      promotable: [],
    });
    expect(out.history).toEqual({
      minDays: 14,
      minSessions: 100,
      days: 14,
      sessions: 100,
      sufficient: true,
    });
    expect(out.proposals).toEqual([
      {
        kind: "unused-skill",
        subject: "handoff",
        command:
          'node skills/bin/harness.mjs idea new --kind harness --title "Remove the unused skill handoff" --hypothesis "If the skill handoff is removed, the harness carries one less thing to maintain and no session misses it" --expected-outcome "No session loads handoff before or after; tokens per idea fall slightly" --measurement "metrics.tokensPerIdea in harness flow report, trailing window" --safety-pattern no-behaviour-change --metric metrics.tokensPerIdea --direction down --window 14d',
      },
      {
        kind: "unused-agent",
        subject: "refiner",
        command:
          'node skills/bin/harness.mjs idea new --kind harness --title "Remove the unused agent refiner" --hypothesis "If the agent refiner is removed, the harness carries one less thing to maintain and no session misses it" --expected-outcome "No session launches refiner before or after; tokens per idea fall slightly" --measurement "metrics.tokensPerIdea in harness flow report, trailing window" --safety-pattern no-behaviour-change --metric metrics.tokensPerIdea --direction down --window 14d',
      },
    ]);
  });

  it("prints a prefilled guardrail request for a promotable audit rule, never activating it", () => {
    const out = proposalsFor({ ...enough, ...none, promotable: ["bare-glob"] });
    expect(out.proposals).toEqual([
      {
        kind: "promotable-rule",
        subject: "bare-glob",
        command:
          "node skills/bin/harness.mjs guardrail request bare-glob --to enforce --idea <idea> --scan <retro-scan.json> --false-positives 0",
      },
    ]);
  });
});

describe("proposalsFor: insufficient history", () => {
  it.each([
    ["too few sessions", { sessions: 99, days: 30 }],
    ["too few days", { sessions: 500, days: 13 }],
  ])("proposes no removal with %s", (_name, history) => {
    const out = proposalsFor({
      ...history,
      skills: ["handoff"],
      agents: ["refiner"],
      promotable: [],
    });
    expect(out.history.sufficient).toBe(false);
    expect(out.proposals).toEqual([]);
  });

  it("still proposes a promotable rule, which carries its own evidence rule", () => {
    const out = proposalsFor({
      sessions: 1,
      days: 0,
      skills: [],
      agents: [],
      promotable: ["bare-glob"],
    });
    expect(out.proposals.map((p) => p.kind)).toEqual(["promotable-rule"]);
  });
});
