import { describe, expect, it } from "vitest";
import type { Terminal } from "../terminal/index.js";
import { reachOf } from "./send-hc-reach.js";

const terminal = (over: Partial<Terminal> & { id: string }): Terminal => ({
  state: "live",
  labels: {},
  cwd: "/work",
  ...over,
});

const WRITER = terminal({
  id: "t3",
  parent: "t1",
  labels: { "kore-session": "image-trust-writer", group: "pair-a" },
});

describe("reachOf says how a caller may reach a terminal", () => {
  it("reaches its parent", () => {
    expect(reachOf(WRITER, terminal({ id: "t1" }))).toBe("parent");
  });

  it("reaches a child whose parent is the caller", () => {
    const child = terminal({ id: "t9", parent: "t3" });
    expect(reachOf(WRITER, child)).toBe("child");
  });

  it("reaches a sibling that shares its group label", () => {
    const sibling = terminal({
      id: "t4",
      parent: "t1",
      labels: { group: "pair-a" },
    });
    expect(reachOf(WRITER, sibling)).toBe("sibling");
  });

  it("refuses a terminal with another group, and one with no group", () => {
    const other = terminal({ id: "t4", labels: { group: "pair-b" } });
    const ungrouped = terminal({ id: "t5", labels: {} });
    expect(reachOf(WRITER, other)).toBeUndefined();
    expect(reachOf(WRITER, ungrouped)).toBeUndefined();
  });

  it("refuses a sibling-looking terminal when the caller has no group", () => {
    const ungroupedCaller = terminal({ id: "t3", parent: "t1", labels: {} });
    const grouped = terminal({ id: "t4", labels: { group: "pair-a" } });
    expect(reachOf(ungroupedCaller, grouped)).toBeUndefined();
  });

  it("refuses an unrelated terminal, and a terminal sending to itself", () => {
    expect(
      reachOf(WRITER, terminal({ id: "t7", parent: "t2" })),
    ).toBeUndefined();
    expect(reachOf(WRITER, WRITER)).toBeUndefined();
  });
});
