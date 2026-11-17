import { describe, expect, it } from "vitest";
import type { IdeaRecord } from "../idea/index.js";
import { sharingWarnings } from "./warnings.js";

const PROBE = "probes.hitRate";

function harness(
  number: string,
  metric: string,
  over: Partial<IdeaRecord> = {},
): IdeaRecord {
  return {
    number,
    slug: `idea-${number}`,
    path: `docs/ideas/${number}-idea-${number}.md`,
    title: `Idea ${number}`,
    summary: "A summary.",
    hypothesis: "A hypothesis.",
    expectedOutcome: "An outcome.",
    measurement: "measured",
    safetyPattern: "no-behaviour-change",
    date: "2026-11-16",
    issue: "866",
    harness: { metric, direction: "down", window: "14d" },
    ...over,
  };
}

describe("sharingWarnings", () => {
  it("warns that a guard metric cannot be one idea's primary", () => {
    const idea = harness("0020", "rework.sendBacksPerIdea");

    expect(sharingWarnings(idea, [idea])).toEqual([
      {
        kind: "guard-metric",
        metric: "rework.sendBacksPerIdea",
        message:
          "rework.sendBacksPerIdea is a guard metric: several ideas move it, so no one idea may claim it as its primary (ADR 0119).",
      },
    ]);
  });

  it("warns on a shared primary, naming each other open idea that names it", () => {
    const idea = harness("0021", PROBE);
    const other = harness("0022", PROBE);

    expect(sharingWarnings(idea, [idea, other])).toEqual([
      {
        kind: "shared-primary",
        metric: PROBE,
        message:
          "probes.hitRate is also the primary of open idea 0022: ideas with one primary open their windows in sequence (ADR 0119).",
      },
    ]);
  });

  it("is quiet when the primary is its own and no other open idea names it", () => {
    const idea = harness("0021", PROBE);
    const elsewhere = harness("0023", "probes.missRate");

    expect(sharingWarnings(idea, [idea, elsewhere])).toEqual([]);
  });

  it("does not count another idea that has an outcome, since it is no longer open", () => {
    const idea = harness("0021", PROBE);
    const closed = harness("0024", PROBE, { outcome: "confirmed" });

    expect(sharingWarnings(idea, [idea, closed])).toEqual([]);
  });

  it("does not count the idea as sharing its primary with itself", () => {
    const idea = harness("0021", PROBE);

    expect(sharingWarnings(idea, [idea])).toEqual([]);
  });

  it("is quiet for an idea that is not a harness idea, whatever the others name", () => {
    const { harness: _unused, ...plain } = harness("0025", PROBE);
    const other = harness("0026", PROBE);

    expect(sharingWarnings(plain, [other])).toEqual([]);
  });

  it("gives both warnings when a guard metric is also another open idea's primary", () => {
    const idea = harness("0027", "friction.total");
    const other = harness("0028", "friction.total");

    expect(sharingWarnings(idea, [idea, other]).map((w) => w.kind)).toEqual([
      "guard-metric",
      "shared-primary",
    ]);
  });
});
