import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "../src/flow/index.js";
import { T0, at } from "../src/testing/index.js";
import type { LedgerEvent } from "../src/ledger/index.js";

const ASOF = new Date(T0 + 1_000_000_000);
const MILLION = 1_000_000;
const SONNET = "claude-sonnet-5-5";

/** A writer session's cumulative reading of Sonnet input tokens. */
const split = (seconds: number, agent: string, lowInput: number) =>
  at(seconds, "token.split", {
    source: "claude",
    agent,
    session: agent,
    model: SONNET,
    lowInput,
  });

/** The writer's session events with no idea of their own: what 0012's measure reads. */
const work = (agent: string): LedgerEvent[] => [
  at(5, "tool.end", { source: "claude", agent, session: agent }),
  at(6, "tool.end", { source: "claude", agent, session: agent }),
  at(7, "tool.end", { source: "claude", agent, session: agent }),
];

/** The pull request's link, as pr open writes it: a session name and no pane. */
const link = (agent: string, number: number, idea?: string) =>
  at(8, "pr.linked", {
    source: "herdr",
    number,
    session: agent,
    agent,
    ...(idea === undefined ? {} : { idea }),
  });

function report(events: LedgerEvent[]): FlowReport {
  return buildReport(events, {
    asOf: ASOF,
    minCompletedIdeas: 1,
    cost: { minMergedChanges: 1 },
  });
}

describe("flow report: writing read per idea through the pull request's link (#1093)", () => {
  // Three writers: one linked to a pull request with idea #7 ($2 per M tokens at Sonnet input),
  // one linked to a pull request that serves no idea, and one with no pr.linked event.
  const events: LedgerEvent[] = [
    ...["a-writer", "b-writer", "c-writer"].map((agent, i) =>
      at(i, "session.launch", {
        source: "herdr",
        agent,
        pane: `w1:p${i + 1}`,
        role: "writer",
        tier: SONNET,
      }),
    ),
    split(10, "a-writer", 2 * MILLION),
    split(10, "b-writer", MILLION),
    split(10, "c-writer", MILLION),
    link("a-writer", 9, "#7"),
    link("b-writer", 10, "none"),
    at(20, "pr.opened", { source: "github", number: 9 }),
    at(20, "pr.opened", { source: "github", number: 10 }),
    // Opened before the link event existed: no link, so unjoinable.
    at(20, "pr.opened", { source: "github", number: 11 }),
  ];

  it("adds the linked writer's tokens and dollars to its idea and reports the two buckets beside it", () => {
    const { costWaiting } = report(events);

    expect(costWaiting.ideas).toEqual([
      {
        idea: "#7",
        dollars: 4,
        tokens: 2 * MILLION,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
    expect(costWaiting.writing).toEqual({
      attributed: { sessions: 1, tokens: 2 * MILLION, dollars: 4 },
      noIdea: { sessions: 1, tokens: MILLION, dollars: 2 },
      noPullRequest: { sessions: 1, tokens: MILLION, dollars: 2 },
      unjoinable: 1,
      share: { status: "measured", share: 0.5, sessions: 3 },
    });
  });
});

describe("flow report: idea 0012's attribution reading and an idea on pr.linked (#1093)", () => {
  const launch = at(0, "session.launch", {
    source: "claude",
    agent: "a-writer",
    session: "a-writer",
    role: "writer",
    tier: SONNET,
  });

  it("moves 0012's reading by the link event alone, never by the writer's own events", () => {
    const withNone = report([
      launch,
      ...work("a-writer"),
      link("a-writer", 9, "none"),
    ]);
    const withIdea = report([
      launch,
      ...work("a-writer"),
      link("a-writer", 9, "#7"),
    ]);

    expect(withIdea.attribution.events).toBe(withNone.attribution.events);
    expect(withIdea.attribution.withIdea - withNone.attribution.withIdea).toBe(
      1,
    );
    expect(withIdea.attribution.noRoleShare).toBe(
      withNone.attribution.noRoleShare,
    );
  });
});
