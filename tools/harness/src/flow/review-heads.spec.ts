import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import {
  headNamings,
  isReviewedAtHead,
  sendBackHeadOf,
  verdictsOf,
} from "./review-heads.js";

vi.mock("./github-waits.js");

let seq = 0;
function event(
  kind: Kind,
  at: number,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent {
  seq += 1;
  return {
    schema: 1,
    id: `e${seq}`,
    source: "claude",
    kind,
    occurredAt: new Date(at).toISOString(),
    recordedAt: new Date(at).toISOString(),
    ...fields,
  };
}

const verdict = (number: number, label: string, at: number, findings = 0) =>
  event("review.run", at, { number, label, findings });
const sendBack = (number: number, label: string, at: number) =>
  event("send-back", at, { number, label });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(time).mockImplementation((e) => Date.parse(e.occurredAt));
});

describe("verdictsOf: the principles-review verdicts the ledger holds", () => {
  it("reads the PR, the head cut to seven characters, the time and the violation count of a posted verdict", () => {
    expect(verdictsOf([verdict(7, "posted:0123456789abcdef", 100, 2)])).toEqual(
      [{ number: 7, head: "0123456", at: 100, findings: 2, rules: [] }],
    );
  });

  it("reads the short rule labels a verdict cites, in the order recorded, and none when no label was recorded", () => {
    const cited = event("review.run", 60, {
      number: 7,
      label: "posted:0123456",
      findings: 2,
      rules: "max-lines,pin-everything",
    });

    expect(verdictsOf([cited])).toEqual([
      {
        number: 7,
        head: "0123456",
        at: 60,
        findings: 2,
        rules: ["max-lines", "pin-everything"],
      },
    ]);
    expect(verdictsOf([verdict(7, "posted:0123456", 61, 1)])[0]?.rules).toEqual(
      [],
    );
  });

  it("reads a verdict left unchanged on its head, and leaves the count unknown when none was recorded", () => {
    const old = event("review.run", 50, {
      number: 7,
      label: "unchanged:abcdef1",
    });

    expect(verdictsOf([old])).toEqual([
      { number: 7, head: "abcdef1", at: 50, findings: undefined, rules: [] },
    ]);
  });

  it("leaves out a re-review, a failed re-review, a review.run with no PR and an event of another kind", () => {
    const events = [
      verdict(7, "resample:abcdef1", 10),
      verdict(7, "resample-failed:abcdef1", 11),
      event("review.run", 12, {
        label: "posted:abcdef1",
        findings: 1,
      }),
      event("send-back", 13, { number: 7, label: "posted:abcdef1" }),
    ];

    expect(verdictsOf(events)).toEqual([]);
  });
});

describe("sendBackHeadOf: the head a send-back's label ends with", () => {
  it("cuts the head after the @ to seven characters", () => {
    expect(sendBackHeadOf(sendBack(7, "scope @89abcdef0", 1))).toBe("89abcde");
  });

  it("is undefined for a send-back that names no head", () => {
    expect(sendBackHeadOf(sendBack(7, "scope creep", 1))).toBeUndefined();
    expect(
      sendBackHeadOf(event("send-back", 1, { number: 7 })),
    ).toBeUndefined();
  });
});

describe("headNamings: every event that names a head of a pull request", () => {
  it("lists the verdicts and the send-backs that name a head, each with its PR and time", () => {
    const events = [
      verdict(7, "posted:aaaaaaa", 100),
      sendBack(7, "scope @bbbbbbb", 200),
      sendBack(7, "no head here", 300),
      sendBack(9, "scope @ccccccc", 400),
    ];

    expect(headNamings(events)).toEqual([
      { number: 7, head: "aaaaaaa", at: 100 },
      { number: 7, head: "bbbbbbb", at: 200 },
      { number: 9, head: "ccccccc", at: 400 },
    ]);
  });

  it("leaves out a send-back that has no pull request number", () => {
    expect(
      headNamings([event("send-back", 1, { label: "scope @aaaaaaa" })]),
    ).toEqual([]);
  });
});

describe("isReviewedAtHead: a verdict counts only for the head it names", () => {
  const MERGED = 1000;

  it("is reviewed when the newest head the ledger names for the PR has a verdict", () => {
    const verdicts = [
      { number: 7, head: "aaaaaaa", at: 100, findings: 0, rules: [] },
    ];
    const namings = [{ number: 7, head: "aaaaaaa", at: 100 }];

    expect(isReviewedAtHead(7, MERGED, verdicts, namings)).toBe(true);
  });

  it("is not reviewed when a later head is named and the only verdict is on the older head", () => {
    const verdicts = [
      { number: 7, head: "aaaaaaa", at: 100, findings: 0, rules: [] },
    ];
    const namings = [
      { number: 7, head: "aaaaaaa", at: 100 },
      { number: 7, head: "bbbbbbb", at: 200 },
    ];

    expect(isReviewedAtHead(7, MERGED, verdicts, namings)).toBe(false);
  });

  it("is reviewed once the later head has its own verdict, however many verdicts the PR has", () => {
    const verdicts = [
      { number: 7, head: "aaaaaaa", at: 100, findings: 1, rules: [] },
      { number: 7, head: "bbbbbbb", at: 300, findings: 0, rules: [] },
      { number: 7, head: "bbbbbbb", at: 310, findings: undefined, rules: [] },
    ];
    const namings = [
      { number: 7, head: "aaaaaaa", at: 100 },
      { number: 7, head: "bbbbbbb", at: 200 },
      { number: 7, head: "bbbbbbb", at: 300 },
      { number: 7, head: "bbbbbbb", at: 310 },
    ];

    expect(isReviewedAtHead(7, MERGED, verdicts, namings)).toBe(true);
  });

  it("is not reviewed with no verdict, and ignores a verdict or head named after the merge or on another PR", () => {
    const namings = [
      { number: 7, head: "aaaaaaa", at: 1500 },
      { number: 8, head: "aaaaaaa", at: 100 },
    ];
    const verdicts = [
      { number: 7, head: "aaaaaaa", at: 1500, findings: 0, rules: [] },
      { number: 8, head: "aaaaaaa", at: 100, findings: 0, rules: [] },
    ];

    expect(isReviewedAtHead(7, MERGED, verdicts, namings)).toBe(false);
    expect(isReviewedAtHead(7, MERGED, [], [])).toBe(false);
  });
});
