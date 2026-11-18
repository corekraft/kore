import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import {
  advisorFigureLines,
  advisorLines,
  routeLines,
  waitLines,
} from "./flow-lines.js";

type Quality = FlowReport["advisorQuality"];
type Routes = FlowReport["ownerRoutes"];
type Waits = FlowReport["waitingOnPerson"];

const QUALITY: Quality = {
  made: 10,
  overturned: 1,
  perMade: 0.1,
  refutingShare: 0.07,
  refuted: true,
};

const NONE_BY_SIGNAL: Routes["bySignal"] = {
  "reserved-category": 0,
  matched: 0,
  "advisor-files": 0,
  escalated: 0,
  unclassifiable: 0,
};

describe("advisorLines: the overturn figure (ADR 0120, #862)", () => {
  it("prints overturned over made against the refuting share, and says the advisor is refuted above it", () => {
    expect(advisorLines(QUALITY)).toEqual([
      "Advisor decisions overturned: 0.1 (1 of 10 made), refuting above 0.07 (refuted)",
    ]);
  });

  it("says nothing is refuted when the share is within the refuting share", () => {
    expect(advisorLines({ ...QUALITY, perMade: 0.05, refuted: false })[0]).toBe(
      "Advisor decisions overturned: 0.05 (1 of 10 made), refuting above 0.07",
    );
  });

  it("says no decision was made in the range, rather than printing a zero share", () => {
    expect(
      advisorLines({
        made: 0,
        overturned: 0,
        perMade: null,
        refutingShare: 0.07,
        refuted: false,
      }),
    ).toEqual([
      "Advisor decisions overturned: 0 of 0 made; none made in this range",
    ]);
  });
});

describe("routeLines: owner-routed questions per signal (ADR 0120, #862)", () => {
  it("prints the owner-routed total, the advisor's share, and each owner signal's count", () => {
    expect(
      routeLines({
        advisor: 4,
        owner: 3,
        bySignal: { ...NONE_BY_SIGNAL, matched: 2, escalated: 1 },
      }),
    ).toEqual([
      "Owner-routed questions: 3 (advisor-routed 4); by signal: reserved-category 0, matched 2, advisor-files 0, escalated 1, unclassifiable 0",
    ]);
  });
});

describe("advisorFigureLines: the figures, in the report's order (ADR 0120, #862, #1036)", () => {
  it("prints the overturn line, the route line, the waiting line, then the handover line", () => {
    const report = {
      advisorQuality: QUALITY,
      ownerRoutes: { advisor: 4, owner: 0, bySignal: NONE_BY_SIGNAL },
      waitingOnPerson: {
        questions: 0,
        answered: 0,
        unanswered: 0,
        waitingSeconds: 0,
        perQuestionSeconds: null,
      },
      handovers: {
        status: "insufficient",
        reason: "no handover reason recorded in the window",
      },
    } as FlowReport;

    const lines = advisorFigureLines(report);

    expect(lines.map((line) => line.split(":")[0])).toEqual([
      "Advisor decisions overturned",
      "Owner-routed questions",
      "Waiting on a person",
      "Handovers from the main session",
    ]);
  });
});

describe("waitLines: waiting on a person (ADR 0120, #862)", () => {
  it("says no question was asked when none was, rather than printing zero seconds", () => {
    const none: Waits = {
      questions: 0,
      answered: 0,
      unanswered: 0,
      waitingSeconds: 0,
      perQuestionSeconds: null,
    };

    expect(waitLines(none)).toEqual([
      "Waiting on a person: no question asked in this range",
    ]);
  });

  it("prints the seconds questions waited on a person, with how many were answered", () => {
    expect(
      waitLines({
        questions: 2,
        answered: 1,
        unanswered: 1,
        waitingSeconds: 920,
        perQuestionSeconds: 460,
      }),
    ).toEqual([
      "Waiting on a person: 920s over 2 question(s), 1 answered, 1 not; 460s per question",
    ]);
  });
});
