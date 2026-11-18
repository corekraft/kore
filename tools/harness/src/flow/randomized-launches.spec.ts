import { describe, expect, it } from "vitest";
import {
  exclusionOf,
  isRandomized,
  windowEffortOf,
} from "./randomized-launches.js";

const drawn = (effort?: string) => ({
  tierReason: "experiment",
  effort,
});
const control = (effort?: string) => ({
  tierReason: "experiment-control",
  effort,
});

describe("isRandomized", () => {
  it("reads a drawn launch and a control launch as randomized", () => {
    expect(isRandomized(drawn("high"))).toBe(true);
    expect(isRandomized(control("high"))).toBe(true);
  });

  it("reads a launch with no reason, an escalation or an override reason as not randomized", () => {
    expect(isRandomized({ effort: "high" })).toBe(false);
    expect(isRandomized({ tierReason: "escalated", effort: "high" })).toBe(
      false,
    );
    expect(isRandomized({ tierReason: "experiments", effort: "high" })).toBe(
      false,
    );
  });
});

describe("exclusionOf", () => {
  it("keeps a randomized launch at the window effort", () => {
    expect(exclusionOf(drawn("high"), "high")).toBeUndefined();
    expect(exclusionOf(control("high"), "high")).toBeUndefined();
  });

  it("excludes a randomized launch at another effort as a different effort", () => {
    expect(exclusionOf(drawn("medium"), "high")).toBe("differentEffort");
    expect(exclusionOf(control("low"), "high")).toBe("differentEffort");
  });

  it("excludes a launch with no recorded effort as a missing effort, randomized or not", () => {
    expect(exclusionOf(drawn(), "high")).toBe("missingEffort");
    expect(exclusionOf({}, "high")).toBe("missingEffort");
  });

  it("excludes a hand-picked launch as not randomized, even at the window effort", () => {
    expect(exclusionOf({ effort: "high" }, "high")).toBe("notRandomized");
    expect(
      exclusionOf({ tierReason: "escalated", effort: "medium" }, "high"),
    ).toBe("notRandomized");
  });

  it("excludes every launch when there is no window effort to read against", () => {
    expect(exclusionOf(drawn("high"), null)).toBe("differentEffort");
  });
});

describe("windowEffortOf", () => {
  it("takes the given effort as the setting, whatever the launches ran at", () => {
    expect(
      windowEffortOf([drawn("medium"), control("medium")], "high"),
    ).toEqual({ effort: "high", from: "setting" });
  });

  it("defaults to the most common effort among randomized launches and says it did", () => {
    const launches = [
      drawn("medium"),
      control("high"),
      control("high"),
      { effort: "medium" },
      { effort: "medium" },
      { effort: "medium" },
    ];

    expect(windowEffortOf(launches, undefined)).toEqual({
      effort: "high",
      from: "most common",
    });
  });

  it("ignores randomized launches with no recorded effort when counting", () => {
    expect(
      windowEffortOf([drawn(), drawn(), control("low")], undefined),
    ).toEqual({ effort: "low", from: "most common" });
  });

  it("breaks a tie by effort name, so the same ledger always gives the same effort", () => {
    expect(
      windowEffortOf([drawn("medium"), control("high")], undefined),
    ).toEqual({ effort: "high", from: "most common" });
  });

  it("has no window effort when no randomized launch recorded one", () => {
    expect(windowEffortOf([{ effort: "high" }, drawn()], undefined)).toEqual({
      effort: null,
      from: "none",
    });
  });
});
