import { describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../queue/index.js";
import {
  escalateStage,
  judgeStage,
  outcomeStage,
  precheckStage,
  queueStage,
  reviewStage,
  runPane,
  sendBackStage,
  writerStage,
  type Delivery,
  type Harness,
  type Launch,
  type PrecheckVerdict,
  type SendBackTier,
} from "./idea-run.js";
import { IDEA, OUTCOME } from "./idea-run.fixtures.js";

interface Answers {
  queue?: QueueItem[];
  wait?: "done" | "blocked";
  delivery?: Delivery;
  precheck?: PrecheckVerdict;
  sendBacks?: SendBackTier;
}

/** A Harness whose every call is logged in order; each call answers from `answers`, or as a clean pass. */
function fakeHarness(answers: Answers = {}) {
  const log: string[] = [];
  const mocks = {
    queue: vi.fn<Harness["queue"]>(() => {
      log.push("queue");
      return Promise.resolve(answers.queue ?? [IDEA]);
    }),
    spawn: vi.fn<Harness["spawn"]>(() => {
      log.push("spawn");
      return Promise.resolve();
    }),
    wait: vi.fn<Harness["wait"]>(() => {
      log.push("wait");
      return Promise.resolve(answers.wait ?? "done");
    }),
    close: vi.fn<Harness["close"]>(() => {
      log.push("close");
      return Promise.resolve();
    }),
    delivery: vi.fn<Harness["delivery"]>(() => {
      log.push("delivery");
      return Promise.resolve(answers.delivery ?? { pr: 50, merged: true });
    }),
    review: vi.fn<Harness["review"]>(() => {
      log.push("review");
      return Promise.resolve();
    }),
    precheck: vi.fn<Harness["precheck"]>(() => {
      log.push("precheck");
      return Promise.resolve(answers.precheck ?? { sendBack: false });
    }),
    sendBack: vi.fn<Harness["sendBack"]>(() => {
      log.push("send-back");
      return Promise.resolve();
    }),
    sendBacks: vi.fn<Harness["sendBacks"]>(() => {
      log.push("send-backs");
      return Promise.resolve(
        answers.sendBacks ?? {
          count: 0,
          escalate: false,
          model: "claude-haiku-5-5",
        },
      );
    }),
    escalate: vi.fn<Harness["escalate"]>(() => {
      log.push("escalate");
      return Promise.resolve();
    }),
    recordOutcome: vi.fn<Harness["recordOutcome"]>(() => {
      log.push("record-outcome");
      return Promise.resolve();
    }),
  };
  return { log, ...mocks, harness: mocks as Harness };
}

describe("runPane", () => {
  const launch: Launch = {
    role: "writer",
    name: "idea-0042-writer",
    issue: 197,
    brief: "Deliver idea 0042.",
  };

  it("spawns the pane, waits for its result, then closes it, and returns that result", async () => {
    const { harness, log, spawn, wait, close } = fakeHarness({ wait: "done" });
    expect(await runPane(harness, launch)).toBe("done");
    expect(log).toEqual(["spawn", "wait", "close"]);
    expect(spawn).toHaveBeenCalledWith(launch);
    expect(wait).toHaveBeenCalledWith("idea-0042-writer");
    expect(close).toHaveBeenCalledWith("idea-0042-writer");
  });

  it("closes a blocked pane too, so no pane is left running", async () => {
    const { harness, log } = fakeHarness({ wait: "blocked" });
    expect(await runPane(harness, launch)).toBe("blocked");
    expect(log).toEqual(["spawn", "wait", "close"]);
  });
});

describe("writerStage", () => {
  it("runs the writer in a worktree for the idea's issue and returns the PR it left", async () => {
    const { harness, spawn, delivery } = fakeHarness({
      delivery: { pr: 50, merged: false },
    });
    expect(await writerStage(harness, "0042", 197, undefined)).toBe(50);
    expect(spawn.mock.calls[0]?.[0]).toStrictEqual({
      role: "writer",
      name: "idea-0042-writer",
      issue: 197,
      worktree: true,
      brief:
        "Deliver idea 0042 (issue #197) as one pull request that says `Refs #197`. Do not merge.",
    });
    expect(delivery).toHaveBeenCalledWith(197);
  });

  it("relaunches the writer on the escalation model when one is given", async () => {
    const { harness, spawn } = fakeHarness();
    await writerStage(harness, "0042", 197, "claude-sonnet-5-5");
    expect(spawn.mock.calls[0]?.[0]).toStrictEqual({
      role: "writer",
      name: "idea-0042-writer",
      issue: 197,
      worktree: true,
      model: "claude-sonnet-5-5",
      brief:
        "Deliver idea 0042 (issue #197) as one pull request that says `Refs #197`. Do not merge.",
    });
  });

  it("returns no PR, and asks GitHub for none, when the writer is blocked", async () => {
    const { harness, delivery } = fakeHarness({ wait: "blocked" });
    expect(await writerStage(harness, "0042", 197, undefined)).toBeUndefined();
    expect(delivery).not.toHaveBeenCalled();
  });

  it("returns no PR when the writer finished without opening one", async () => {
    const { harness } = fakeHarness({ delivery: { merged: false } });
    expect(await writerStage(harness, "0042", 197, undefined)).toBeUndefined();
  });
});

describe("reviewStage", () => {
  it("runs the review for the PR and asks nothing else", async () => {
    const { harness, log, review } = fakeHarness();
    await reviewStage(harness, 50);
    expect(review).toHaveBeenCalledWith(50);
    expect(log).toEqual(["review"]);
  });

  it("lets a review that posts no verdict stop the run with its error", async () => {
    const { harness, review } = fakeHarness();
    review.mockRejectedValueOnce(
      new Error("The Reviewer ended with no verdict."),
    );
    await expect(reviewStage(harness, 50)).rejects.toThrow(
      "The Reviewer ended with no verdict.",
    );
  });
});

describe("precheckStage", () => {
  it("returns the precheck's verdict as given, without sending anything back itself", async () => {
    const verdict: PrecheckVerdict = {
      sendBack: true,
      reason: "No valid declaration.",
      category: "declaration",
    };
    const { harness, log, precheck } = fakeHarness({ precheck: verdict });
    expect(await precheckStage(harness, 50)).toStrictEqual(verdict);
    expect(precheck).toHaveBeenCalledWith(50);
    expect(log).toEqual(["precheck"]);
  });
});

describe("sendBackStage", () => {
  it("sends the reason and category back on the PR and launches no pane", async () => {
    const { harness, log, sendBack } = fakeHarness();
    await sendBackStage(harness, 50, "No valid declaration.", "declaration");
    expect(sendBack).toHaveBeenCalledWith(
      50,
      "No valid declaration.",
      "declaration",
    );
    expect(log).toEqual(["send-back"]);
  });
});

describe("judgeStage", () => {
  it("runs the judge pane for the PR and reports the merge the judge left", async () => {
    const { harness, log, spawn, delivery } = fakeHarness({
      delivery: { pr: 50, merged: true },
    });
    expect(await judgeStage(harness, "0042", 50, 197)).toBe(true);
    expect(spawn.mock.calls[0]?.[0]).toStrictEqual({
      role: "judge",
      name: "idea-0042-judge",
      issue: 197,
      brief:
        "Judge PR #50 for idea 0042 (issue #197): run the precheck, then approve and merge it, or send it back with the reason.",
    });
    expect(log).toEqual(["spawn", "wait", "close", "delivery"]);
    expect(delivery).toHaveBeenCalledWith(197);
  });

  it("reports not merged when the judge leaves the PR open", async () => {
    const { harness } = fakeHarness({ delivery: { pr: 50, merged: false } });
    expect(await judgeStage(harness, "0042", 50, 197)).toBe(false);
  });
});

describe("escalateStage", () => {
  it("changes nothing and escalates nothing below two send-backs", async () => {
    const { harness, log, escalate } = fakeHarness({
      sendBacks: { count: 1, escalate: false, model: "claude-haiku-5-5" },
    });
    const state = { escalated: false, model: undefined };
    expect(await escalateStage(harness, 50, state)).toStrictEqual({
      escalated: false,
      model: undefined,
    });
    expect(escalate).not.toHaveBeenCalled();
    expect(log).toEqual(["send-backs"]);
  });

  it("escalates the PR once and moves the writer to the tier's model", async () => {
    const { harness, log, escalate } = fakeHarness({
      sendBacks: { count: 2, escalate: true, model: "claude-sonnet-5-5" },
    });
    const state = { escalated: false, model: undefined };
    expect(await escalateStage(harness, 50, state)).toStrictEqual({
      escalated: true,
      model: "claude-sonnet-5-5",
    });
    expect(escalate).toHaveBeenCalledWith(50);
    expect(log).toEqual(["send-backs", "escalate"]);
  });

  it("does not escalate the PR a second time once it has been escalated", async () => {
    const { harness, escalate } = fakeHarness({
      sendBacks: { count: 3, escalate: true, model: "claude-sonnet-5-5" },
    });
    const state = { escalated: true, model: "claude-sonnet-5-5" };
    expect(await escalateStage(harness, 50, state)).toStrictEqual({
      escalated: true,
      model: "claude-sonnet-5-5",
    });
    expect(escalate).not.toHaveBeenCalled();
  });
});

describe("queueStage", () => {
  it("returns the queued idea, read from the queue", async () => {
    const { harness, log } = fakeHarness({ queue: [IDEA] });
    expect(await queueStage(harness, "0042")).toStrictEqual(IDEA);
    expect(log).toEqual(["queue"]);
  });

  it("returns nothing for an idea that is not queued, ignoring other items", async () => {
    const { harness } = fakeHarness({
      queue: [
        { kind: "send-back", pr: 50, count: 1, since: "2026-01-01T00:00:00Z" },
        {
          kind: "idea",
          idea: "0007",
          issue: 194,
          since: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(await queueStage(harness, "0042")).toBeUndefined();
  });
});

describe("outcomeStage", () => {
  it("records the measured outcome against the idea", async () => {
    const { harness, log, recordOutcome } = fakeHarness();
    await outcomeStage(harness, "0042", OUTCOME);
    expect(recordOutcome).toHaveBeenCalledWith("0042", OUTCOME);
    expect(log).toEqual(["record-outcome"]);
  });
});
