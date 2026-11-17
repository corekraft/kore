import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { IdeaPane, TickPorts } from "./tick.js";
import { Tick } from "./tick.js";
import type { PassGate } from "./tick-bounds.js";
import type { JudgmentOutcome, TickJudgment } from "./tick-judgment.js";

vi.mock("./idea-run.js", () => ({
  escalateStage: vi.fn(),
  judgeLaunch: vi.fn(),
  outcomeStage: vi.fn(),
  precheckStage: vi.fn(),
  reviewStage: vi.fn(),
  sendBackStage: vi.fn(),
  writerLaunch: vi.fn(),
}));

const HEAD = "abcdef1234567890";
const THIRD = { count: 3, model: "claude-sonnet-5-5", escalate: true };

function ports(over: Partial<TickPorts> = {}): TickPorts {
  return {
    queue: vi.fn().mockResolvedValue([
      { kind: "idea", idea: "0001", issue: 11, since: "2026-11-16" },
      { kind: "send-back", pr: 7, count: 3, since: "2026-11-16" },
    ]),
    panes: vi.fn().mockResolvedValue([]),
    delivery: vi.fn().mockResolvedValue({ pr: 7, merged: false }),
    head: vi.fn().mockResolvedValue(HEAD),
    reviewPosted: vi.fn().mockResolvedValue(true),
    spawn: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sendBacks: vi.fn().mockResolvedValue(THIRD),
    ...over,
  } as unknown as TickPorts;
}

const pane = (name: string, state: IdeaPane["state"]): IdeaPane => ({
  name,
  state,
});

/** A judgment flow's answers. `port` is what a Tick takes; the mocks are what the spec asserts on. */
interface Fake {
  port: TickJudgment;
  begun: Mock;
  begin: Mock;
  consume: Mock;
}

/** A judgment flow whose calls answer as given; `begin` may also call its admission, as the real one does. */
function judgment(over: {
  begun?: boolean;
  begin?: JudgmentOutcome | ((...args: unknown[]) => Promise<JudgmentOutcome>);
  consume?: JudgmentOutcome;
}): Fake {
  const begun = vi.fn().mockReturnValue(over.begun ?? false);
  const begin =
    typeof over.begin === "function"
      ? vi.fn().mockImplementation(over.begin)
      : vi.fn().mockResolvedValue(
          over.begin ?? {
            step: "spawn-judgment",
            pane: "idea-0001-judgment-r1",
          },
        );
  const consume = vi.fn().mockResolvedValue(over.consume);
  return {
    begun,
    begin,
    consume,
    port: { begun, begin, consume } as unknown as TickJudgment,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Tick starts a judgment pane for a third send-back", () => {
  it("starts the first judgment pane with the pull request and the send-back count", async () => {
    const j = judgment({});

    expect(
      await new Tick(ports(), new Map(), undefined, j.port).pass(),
    ).toEqual([
      {
        idea: "0001",
        issue: 11,
        step: "spawn-judgment",
        pr: 7,
        pane: "idea-0001-judgment-r1",
      },
    ]);
    expect(j.begin).toHaveBeenCalledWith(
      "0001",
      11,
      7,
      3,
      expect.any(Function),
    );
  });

  it("reports needs-judgment and starts nothing once a judgment flow has begun", async () => {
    const j = judgment({ begun: true });

    expect(
      await new Tick(ports(), new Map(), undefined, j.port).pass(),
    ).toEqual([{ idea: "0001", issue: 11, step: "needs-judgment", pr: 7 }]);
    expect(j.begin).not.toHaveBeenCalled();
  });

  it("reports the bound a held judgment start was held by", async () => {
    const j = judgment({ begin: { step: "held", bound: "load" } });

    expect(
      await new Tick(ports(), new Map(), undefined, j.port).pass(),
    ).toEqual([
      { idea: "0001", issue: 11, step: "held", pr: 7, bound: "load" },
    ]);
  });

  it("admits a judgment start through the host bounds a writer's start obeys", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const gate: PassGate = {
      read: vi.fn().mockResolvedValue({ saver: false, hold: "load" }),
      record,
    };
    const j = judgment({
      begin: async (...args: unknown[]) => {
        const admit = args[4] as () => Promise<string | undefined>;
        const bound = await admit();
        return bound === undefined
          ? { step: "spawn-judgment", pane: "x" }
          : { step: "held", bound: "load" };
      },
    });

    const steps = await new Tick(ports(), new Map(), gate, j.port).pass();

    expect(steps).toEqual([
      { idea: "0001", issue: 11, step: "held", pr: 7, bound: "load" },
    ]);
    expect(record).toHaveBeenCalledWith(11, "load");
  });
});

describe("Tick consumes a finished judgment pane before it closes panes", () => {
  it("takes the judgment's step for a finished judgment pane, and closes nothing", async () => {
    const j = judgment({ consume: { step: "needs-info" } });
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane("idea-0001-judgment-r1", "done")]),
    });

    expect(await new Tick(p, new Map(), undefined, j.port).pass()).toEqual([
      { idea: "0001", issue: 11, step: "needs-info" },
    ]);
    expect(p.close).not.toHaveBeenCalled();
    expect(j.consume).toHaveBeenCalledWith(
      "0001",
      11,
      [pane("idea-0001-judgment-r1", "done")],
      expect.any(Function),
    );
  });

  it("reports the pane a consumed step started", async () => {
    const j = judgment({ consume: { step: "spawn-readers" } });
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane("idea-0001-judgment-r1", "done")]),
    });

    expect(await new Tick(p, new Map(), undefined, j.port).pass()).toEqual([
      { idea: "0001", issue: 11, step: "spawn-readers" },
    ]);
  });

  it("closes a finished pane the judgment does not consume, as before", async () => {
    const j = judgment({});
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane("idea-0001-writer", "done")]),
    });

    expect(await new Tick(p, new Map(), undefined, j.port).pass()).toEqual([
      { idea: "0001", issue: 11, step: "close", pane: "idea-0001-writer" },
    ]);
    expect(p.close).toHaveBeenCalledWith("idea-0001-writer");
  });

  it("keeps an idea waiting while a judgment pane runs, and consumes nothing", async () => {
    const j = judgment({});
    const p = ports({
      panes: vi
        .fn()
        .mockResolvedValue([pane("idea-0001-judgment-r1", "running")]),
    });

    expect(await new Tick(p, new Map(), undefined, j.port).pass()).toEqual([
      { idea: "0001", issue: 11, step: "waiting" },
    ]);
    expect(j.consume).not.toHaveBeenCalled();
  });
});
