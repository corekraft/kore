import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import { REPOSITORY_KINDS, guardBlocks, outcomes } from "./outcomes.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const MINUTE = 60_000;
const WINDOW: [number, number] = [0, 10 * MINUTE * 100];

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(ms: number, kind: Kind, fields: Partial<LedgerEvent> = {}) {
  return {
    schema: 1,
    id: String(ms),
    source: "github",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...fields,
  } satisfies LedgerEvent;
}

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
});

describe("outcomes rates", () => {
  it("is the failed check runs over the concluded check runs on main", () => {
    const r = outcomes(
      [
        event(1, "ci.main", { outcome: "success" }),
        event(2, "ci.main", { outcome: "failure" }),
        event(3, "ci.main", { outcome: "success" }),
      ],
      WINDOW,
    );
    expect(r.mainRed).toEqual({ runs: 3, failed: 1, rate: 0.3333 });
  });

  it("is the passed nightly runs over the concluded nightly runs", () => {
    const r = outcomes(
      [
        event(1, "ci.nightly", { outcome: "success" }),
        event(2, "ci.nightly", { outcome: "failure" }),
      ],
      WINDOW,
    );
    expect(r.liveRuns).toEqual({ runs: 2, passed: 1, rate: 0.5 });
  });

  it("counts reverts over the merged pull requests", () => {
    const r = outcomes(
      [
        event(1, "main.revert"),
        event(2, "pr.merged", { number: 1 }),
        event(3, "pr.merged", { number: 2 }),
        event(4, "pr.merged", { number: 3 }),
        event(5, "pr.merged", { number: 4 }),
      ],
      WINDOW,
    );
    expect(r.reverts).toEqual({ reverts: 1, merged: 4, rate: 0.25 });
  });

  it("is null, never zero, when nothing was measured", () => {
    const r = outcomes([event(1, "main.revert")], WINDOW);
    expect(r.mainRed.rate).toBeNull();
    expect(r.liveRuns.rate).toBeNull();
    expect(r.reverts.rate).toBeNull();
  });

  it("counts only the events inside the window", () => {
    vi.mocked(inWindow).mockImplementation((_window, at) => at < 5);
    const r = outcomes(
      [
        event(1, "ci.main", { outcome: "failure" }),
        event(9, "ci.main", { outcome: "failure" }),
      ],
      WINDOW,
    );
    expect(inWindow).toHaveBeenCalledWith(WINDOW, 9);
    expect(r.mainRed).toEqual({ runs: 1, failed: 1, rate: 1 });
  });
});

describe("owner minutes count only work on ideas", () => {
  it("counts actions on an idea's issue and on a pull request that closes one", () => {
    const r = outcomes(
      [
        event(0, "issue.opened", { number: 7 }),
        event(1 * MINUTE, "owner.action", { number: 7 }),
        event(2 * MINUTE, "pr.opened", { number: 8, idea: "#7" }),
        event(3 * MINUTE, "owner.action", { number: 8 }),
      ],
      WINDOW,
    );
    expect(r.ownerMinutes.minutes).toBe(2);
  });

  it("does not count actions on an issue or pull request that is no idea's", () => {
    const r = outcomes(
      [
        event(0, "pr.opened", { number: 9 }),
        event(MINUTE, "owner.action", { number: 9 }),
        event(5 * MINUTE, "owner.action", { number: 12 }),
      ],
      WINDOW,
    );
    expect(r.ownerMinutes.minutes).toBe(0);
  });
});

describe("owner minutes per merged change", () => {
  it("joins actions less than ten minutes apart into one burst of its length", () => {
    const r = outcomes(
      [
        event(0, "issue.opened", { number: 1 }),
        event(0, "owner.action", { number: 1 }),
        event(9 * MINUTE, "owner.action", { number: 1 }),
        event(1, "pr.merged", { number: 2, idea: "#1" }),
      ],
      WINDOW,
    );
    expect(r.ownerMinutes).toEqual({
      minutes: 9,
      merged: 1,
      perMerged: 9,
      burstGapMinutes: 10,
      upperBound: true,
    });
  });

  it("starts a new burst after a gap of ten minutes, and charges a lone action one minute", () => {
    const r = outcomes(
      [
        event(0, "issue.opened", { number: 1 }),
        event(0, "owner.action", { number: 1 }),
        event(10 * MINUTE, "owner.action", { number: 1 }),
      ],
      WINDOW,
    );
    expect(r.ownerMinutes.minutes).toBe(2);
  });

  it("has no per-change figure when nothing merged", () => {
    const r = outcomes(
      [
        event(0, "issue.opened", { number: 1 }),
        event(0, "owner.action", { number: 1 }),
        event(5 * MINUTE, "owner.action", { number: 1 }),
      ],
      WINDOW,
    );
    expect(r.ownerMinutes).toEqual({
      minutes: 5,
      merged: 0,
      perMerged: null,
      burstGapMinutes: 10,
      upperBound: true,
    });
  });
});

describe("guardBlocks", () => {
  it("counts blocks by rule, most blocked first, ties by rule name", () => {
    const blocked = (ms: number, label: string) =>
      event(ms, "guard.block", { label });
    expect(
      guardBlocks(
        [
          blocked(1, "b-rule"),
          blocked(2, "b-rule"),
          blocked(3, "a-rule"),
          blocked(4, "a-rule"),
          blocked(5, "c-rule"),
        ],
        WINDOW,
      ),
    ).toEqual([
      { rule: "a-rule", blocks: 2 },
      { rule: "b-rule", blocks: 2 },
      { rule: "c-rule", blocks: 1 },
    ]);
  });

  it("leaves out blocks with no rule, other kinds, and blocks outside the window", () => {
    vi.mocked(inWindow).mockImplementation((_window, at) => at < 5);
    expect(
      guardBlocks(
        [
          event(1, "guard.block"),
          event(2, "tool.start", { label: "x" }),
          event(3, "guard.block", { label: "kept" }),
          event(9, "guard.block", { label: "late" }),
        ],
        WINDOW,
      ),
    ).toEqual([{ rule: "kept", blocks: 1 }]);
  });
});

describe("REPOSITORY_KINDS", () => {
  it("holds host samples, which belong to no idea, so they are never counted as unmapped work", () => {
    expect(REPOSITORY_KINDS.has("host-sample")).toBe(true);
  });

  it("holds unstamped spawns, which record a session and belong to no idea or stage", () => {
    expect(REPOSITORY_KINDS.has("spawn.unstamped")).toBe(true);
  });
});
