import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { openOwnerQuestions } from "./owner-queue.js";

function event(overrides: Partial<LedgerEvent>): LedgerEvent {
  return {
    schema: 1,
    id: "e",
    source: "claude",
    kind: "decision.routed",
    occurredAt: "2026-11-17T10:00:00.000Z",
    recordedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  } as LedgerEvent;
}

const ASKED = event({
  id: "q1",
  idea: "0008",
  label: "destruction",
  route: "owner",
  signal: "reserved-category",
  occurredAt: "2026-11-17T10:00:00.000Z",
});

describe("openOwnerQuestions", () => {
  it("lists each owner route once, oldest first, with its idea and category", () => {
    const later = event({
      id: "q2",
      idea: "0009",
      label: "credentials",
      route: "owner",
      signal: "matched",
      occurredAt: "2026-11-17T11:00:00.000Z",
    });

    expect(openOwnerQuestions([later, ASKED])).toEqual([
      {
        idea: "0008",
        category: "destruction",
        since: "2026-11-17T10:00:00.000Z",
        blocking: false,
      },
      {
        idea: "0009",
        category: "credentials",
        since: "2026-11-17T11:00:00.000Z",
        blocking: false,
      },
    ]);
  });

  it("leaves out advisor routes, decisions and every other kind", () => {
    const advised = event({
      id: "a1",
      idea: "0010",
      label: "naming",
      route: "advisor",
      signal: "agreed",
    });
    const made = event({
      id: "m1",
      kind: "decision.made",
      idea: "0011",
      label: "naming",
    });

    expect(openOwnerQuestions([advised, made])).toEqual([]);
  });

  it("does not list an owner route with no idea, since no issue can carry its question", () => {
    const orphan = event({ id: "o1", label: "naming", route: "owner" });

    expect(openOwnerQuestions([orphan])).toEqual([]);
  });
});

describe("openOwnerQuestions blocking marks", () => {
  it("lists a question blocking first when the tick marked its idea after it was asked", () => {
    const older = event({
      id: "q0",
      idea: "0007",
      label: "parked",
      route: "owner",
      signal: "matched",
      occurredAt: "2026-11-17T08:00:00.000Z",
    });
    const mark = event({
      id: "b1",
      kind: "decision.blocking",
      idea: "0008",
      occurredAt: "2026-11-17T12:00:00.000Z",
    });

    expect(openOwnerQuestions([older, ASKED, mark])).toEqual([
      {
        idea: "0008",
        category: "destruction",
        since: "2026-11-17T10:00:00.000Z",
        blocking: true,
      },
      {
        idea: "0007",
        category: "parked",
        since: "2026-11-17T08:00:00.000Z",
        blocking: false,
      },
    ]);
  });

  it("does not mark a question blocking from a mark the tick wrote before the question was asked", () => {
    const earlierMark = event({
      id: "b0",
      kind: "decision.blocking",
      idea: "0008",
      occurredAt: "2026-11-17T09:00:00.000Z",
    });

    expect(openOwnerQuestions([ASKED, earlierMark])).toEqual([
      {
        idea: "0008",
        category: "destruction",
        since: "2026-11-17T10:00:00.000Z",
        blocking: false,
      },
    ]);
  });
});
