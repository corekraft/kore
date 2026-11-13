// What the inventory's git history says about a rule's mode (ADR 0080): when
// it entered its current mode, and whether a requested mode was ever reached.
import { describe, expect, it } from "vitest";
import { FakeRunner } from "../runtime/runner-support.js";
import { ModeHistory } from "./history.js";
import { gitHistory, inventoryOf } from "./history-support.js";

const at = (runner: FakeRunner) => new ModeHistory(runner, "/repo");

describe("ModeHistory.enteredMode", () => {
  it("is the date of the first commit of the unbroken run in the current mode", async () => {
    const runner = new FakeRunner(
      gitHistory([
        {
          sha: "c4",
          date: "2026-11-10T08:00:00+09:00",
          text: inventoryOf({ r: "audit" }),
        },
        {
          sha: "c3",
          date: "2026-11-05T08:00:00+09:00",
          text: inventoryOf({ r: "audit" }),
        },
        {
          sha: "c2",
          date: "2026-10-20T08:00:00+09:00",
          text: inventoryOf({ r: "enforce" }),
        },
        {
          sha: "c1",
          date: "2026-10-01T08:00:00+09:00",
          text: inventoryOf({ r: "audit" }),
        },
      ]),
    );
    expect(await at(runner).enteredMode("r", "audit")).toBe("2026-11-05");
  });

  it("is the date a rule was added when its mode never changed", async () => {
    const runner = new FakeRunner(
      gitHistory([
        {
          sha: "c2",
          date: "2026-11-02T08:00:00Z",
          text: inventoryOf({ r: "audit", other: "audit" }),
        },
        {
          sha: "c1",
          date: "2026-10-01T08:00:00Z",
          text: inventoryOf({ other: "audit" }),
        },
      ]),
    );
    expect(await at(runner).enteredMode("r", "audit")).toBe("2026-11-02");
  });

  it("is unknown when git cannot answer or the newest commit holds another mode", async () => {
    const broken = new FakeRunner([
      {
        match: () => true,
        result: { code: 128, stderr: "fatal: not a git repository" },
      },
    ]);
    expect(await at(broken).enteredMode("r", "audit")).toBeUndefined();
    const uncommitted = new FakeRunner(
      gitHistory([
        {
          sha: "c1",
          date: "2026-11-02T08:00:00Z",
          text: inventoryOf({ r: "enforce" }),
        },
      ]),
    );
    expect(await at(uncommitted).enteredMode("r", "audit")).toBeUndefined();
  });
});

describe("ModeHistory.reached", () => {
  const history = gitHistory([
    {
      sha: "c3",
      date: "2026-11-09T00:00:00Z",
      text: inventoryOf({ r: "audit" }),
    },
    {
      sha: "c2",
      date: "2026-11-06T00:00:00Z",
      text: inventoryOf({ r: "enforce" }),
    },
    {
      sha: "c1",
      date: "2026-11-01T00:00:00Z",
      text: inventoryOf({ r: "audit" }),
    },
  ]);

  it("is true when a commit after the time held the mode, even if it was reverted since", async () => {
    expect(
      await at(new FakeRunner(history)).reached(
        "r",
        "enforce",
        "2026-11-03T00:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("is false when only a commit before the time held the mode", async () => {
    expect(
      await at(new FakeRunner(history)).reached(
        "r",
        "enforce",
        "2026-11-07T00:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("treats removal as the rule's absence from a later commit", async () => {
    const removed = gitHistory([
      {
        sha: "c2",
        date: "2026-11-09T00:00:00Z",
        text: inventoryOf({ other: "audit" }),
      },
      {
        sha: "c1",
        date: "2026-11-01T00:00:00Z",
        text: inventoryOf({ r: "audit", other: "audit" }),
      },
    ]);
    expect(
      await at(new FakeRunner(removed)).reached(
        "r",
        "remove",
        "2026-11-03T00:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("is false, not an error, when git cannot answer", async () => {
    const broken = new FakeRunner([
      { match: () => true, result: { code: 128, stderr: "fatal" } },
    ]);
    expect(
      await at(broken).reached("r", "enforce", "2026-11-03T00:00:00.000Z"),
    ).toBe(false);
  });
});
