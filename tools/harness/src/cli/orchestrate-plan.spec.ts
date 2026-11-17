import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "../ledger/index.js";
import {
  PLANS_DIRECTORY,
  TickPlanStore,
  checkPlan,
  pieceNameProblem,
  tickFlagOn,
} from "../orchestrator/index.js";
import { mainRoot } from "../runtime/index.js";
import { fakeContext } from "./command-support.js";
import { planCommand } from "./orchestrate-plan.js";

vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: vi.fn(),
}));
vi.mock("../orchestrator/index.js", () => ({
  PLANS_DIRECTORY: ".kore/state/tick-plans",
  TickPlanStore: vi.fn(),
  checkPlan: vi.fn(),
  pieceNameProblem: vi.fn(),
  tickFlagOn: vi.fn(),
}));
vi.mock("../runtime/index.js", () => ({ mainRoot: vi.fn() }));

const WORK = [
  {
    role: "writer" as const,
    name: "docs",
    brief: "Document the piece.",
    files: ["docs/guides/contributor.md"],
    after: [],
  },
  {
    role: "writer" as const,
    name: "tests",
    brief: "Test the piece.",
    files: [],
    after: ["docs"],
  },
];

const PLAN_TEXT = JSON.stringify({ work: WORK });

const write = vi.fn();
const list = vi.fn();
const record = vi.fn();

function setup(
  stdin = PLAN_TEXT,
  options: Record<string, string | boolean> = { idea: "0007", issue: "794" },
  json = false,
) {
  const base = fakeContext({ json, options });
  const context = {
    ...base.context,
    deps: { ...base.deps, stdin: () => Promise.resolve(stdin) },
  };
  return { ...base, context };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(tickFlagOn).mockResolvedValue(true);
  vi.mocked(checkPlan).mockReturnValue({
    ok: true,
    plan: { kind: "work", work: WORK },
  });
  vi.mocked(pieceNameProblem).mockReturnValue(undefined);
  vi.mocked(TickPlanStore).mockImplementation(function () {
    return { write } as unknown as TickPlanStore;
  });
  vi.mocked(Ledger).mockImplementation(function () {
    return { list, record } as unknown as Ledger;
  });
  write.mockResolvedValue({ status: "written" });
  list.mockResolvedValue({ events: [], skipped: 0 });
  record.mockResolvedValue({ ok: true, event: {} });
});

describe("orchestrate plan with the flag off", () => {
  it("writes nothing and says the flag is off, so the tick stays dark", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(false);
    const { context, out, err } = setup();

    expect(await planCommand.run(context)).toBe(1);
    expect(err()).toBe(
      "The orchestrator-tick flag is off in the local overlay, so no work plan was recorded.\n",
    );
    expect(out()).toBe("");
    expect(write).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe("orchestrate plan refusals", () => {
  it("refuses a plan that is not JSON, writing nothing", async () => {
    const { context, err } = setup("not json");

    expect(await planCommand.run(context)).toBe(1);
    expect(err()).toBe(
      "The plan on stdin is not valid JSON; give it one JSON object with a work list. Nothing was recorded.\n",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a plan that does not check, with the checker's reason, writing nothing", async () => {
    vi.mocked(checkPlan).mockReturnValue({
      ok: false,
      error: "Plan work item 1 has field name: bad. The whole plan is refused.",
    });
    const { context, err } = setup();

    expect(await planCommand.run(context)).toBe(1);
    expect(err()).toBe(
      "Plan work item 1 has field name: bad. The whole plan is refused.\n",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a plan that is not a work plan, writing nothing", async () => {
    vi.mocked(checkPlan).mockReturnValue({
      ok: true,
      plan: { kind: "stop", reason: "send it to the owner" },
    });
    const { context, err } = setup();

    expect(await planCommand.run(context)).toBe(1);
    expect(err()).toBe(
      "The plan on stdin must be a work plan: give it one object with a work list. Nothing was recorded.\n",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a piece whose pane name spawn would refuse, writing nothing", async () => {
    vi.mocked(pieceNameProblem).mockReturnValue(
      "Session name is unusable; shorten it.",
    );
    const { context, err } = setup();

    expect(await planCommand.run(context)).toBe(1);
    expect(err()).toBe("Session name is unusable; shorten it.\n");
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a different plan the store already holds for the idea, and records no event", async () => {
    write.mockResolvedValue({
      status: "refused",
      error:
        "Idea 0007 already has a persisted work plan that differs from this one; nothing was changed. The owner decides whether to replace it.",
    });
    const { context, err } = setup();

    expect(await planCommand.run(context)).toBe(1);
    expect(err()).toBe(
      "Idea 0007 already has a persisted work plan that differs from this one; nothing was changed. The owner decides whether to replace it.\n",
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a run without an idea, naming the flag it needs", async () => {
    const { context, err } = setup(PLAN_TEXT, { issue: "794" });

    expect(await planCommand.run(context)).toBe(1);
    expect(err()).toBe(
      "Give the idea with --idea, for example --idea 0007, and its issue with --issue.\n",
    );
    expect(write).not.toHaveBeenCalled();
  });
});

describe("orchestrate plan recording", () => {
  it("persists a new plan and records one tick.plan event with the piece count", async () => {
    const { context, out } = setup();

    expect(await planCommand.run(context)).toBe(0);
    expect(write).toHaveBeenCalledWith({
      idea: "0007",
      issue: 794,
      work: WORK,
    });
    expect(record).toHaveBeenCalledWith({
      source: "claude",
      kind: "tick.plan",
      occurredAt: "2026-01-02T03:04:05.000Z",
      idea: "0007",
      number: 2,
    });
    expect(out()).toBe("Recorded the work plan for idea 0007: 2 pieces.\n");
  });

  it("keeps the store under the main checkout's state directory", async () => {
    const { context } = setup();

    await planCommand.run(context);
    expect(TickPlanStore).toHaveBeenCalledWith(
      expect.anything(),
      `/main/${PLANS_DIRECTORY}`,
    );
  });

  it("records nothing again when the same plan and its event are already there", async () => {
    write.mockResolvedValue({ status: "same" });
    list.mockResolvedValue({
      events: [{ kind: "tick.plan", idea: "0007" }],
      skipped: 0,
    });
    const { context, out } = setup();

    expect(await planCommand.run(context)).toBe(0);
    expect(record).not.toHaveBeenCalled();
    expect(out()).toBe(
      "The work plan for idea 0007 is already recorded: 2 pieces, nothing written.\n",
    );
  });

  it("records the missing event when the plan is already there from an earlier run", async () => {
    write.mockResolvedValue({ status: "same" });
    const { context, out } = setup();

    expect(await planCommand.run(context)).toBe(0);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tick.plan", idea: "0007", number: 2 }),
    );
    expect(out()).toBe("Recorded the work plan for idea 0007: 2 pieces.\n");
  });

  it("prints the result as JSON when asked, with the status of the plan and of the event", async () => {
    const { context, out } = setup(
      PLAN_TEXT,
      { idea: "0007", issue: "794" },
      true,
    );

    expect(await planCommand.run(context)).toBe(0);
    expect(JSON.parse(out())).toEqual({
      idea: "0007",
      pieces: 2,
      plan: "written",
      event: "recorded",
    });
  });
});
