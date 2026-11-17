import { describe, expect, it } from "vitest";
import {
  DECISION_ROUTE_SIGNALS,
  DECISION_ROUTES,
} from "./schema-decision-route.js";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-17T10:00:00.000Z" };
const routed = {
  ...stamp,
  kind: "decision.routed",
  idea: "0008",
  label: "naming",
  route: "owner",
  signal: "matched",
};

describe("the decision.routed event", () => {
  it("is a kind a tool may record, never one only the poller writes", () => {
    expect(KINDS).toContain("decision.routed");
    expect(POLLER_KINDS).not.toContain("decision.routed");
  });

  it("records the route, the category and the signal of one routed question", () => {
    expect(parseEvent(routed, "input").ok).toBe(true);
    expect(
      parseEvent({ ...routed, route: "advisor", signal: "agreed" }, "input").ok,
    ).toBe(true);
  });

  it("names only the two routes, so a route to neither party is refused", () => {
    expect(DECISION_ROUTES).toEqual(["advisor", "owner"]);
    expect(parseEvent({ ...routed, route: "both" }, "input")).toMatchObject({
      ok: false,
      field: "route",
    });
  });

  it("refuses a signal outside the closed list the router records", () => {
    expect(DECISION_ROUTE_SIGNALS).toEqual([
      "reserved-category",
      "matched",
      "advisor-files",
      "escalated",
      "unclassifiable",
      "agreed",
    ]);
    expect(parseEvent({ ...routed, signal: "guessed" }, "input")).toMatchObject(
      {
        ok: false,
        field: "signal",
      },
    );
  });
});

describe("the decision.routed fields", () => {
  it("requires a route and a signal on every decision.routed event", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "decision.routed",
          idea: "0008",
          label: "naming",
          signal: "agreed",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "route" });
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "decision.routed",
          idea: "0008",
          label: "naming",
          route: "advisor",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "signal" });
  });

  it("refuses a route on any other kind, so no other event can claim a routing", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "decision.made",
          idea: "0008",
          label: "naming",
          route: "owner",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "route" });
  });

  it("refuses a decision.routed event with no category, since the label is where the category is recorded", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "decision.routed",
          idea: "0008",
          route: "owner",
          signal: "matched",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "label" });
  });

  it("refuses question or action text, which stays out of the ledger", () => {
    expect(
      parseEvent({ ...routed, question: "Median or P50?" }, "input"),
    ).toMatchObject({
      ok: false,
      field: "question",
    });
  });
});
