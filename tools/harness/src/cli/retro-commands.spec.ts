// The retro commands: flags in, the Retro unit and the report builder mocked, output out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "../flow/index.js";
import { Retro, RetroError, metricsOf } from "../retro/index.js";
import { readPlans } from "../plan/index.js";
import { fakeContext, fakeLedger } from "./command-support.js";
import { loadCost } from "./flow-commands.js";
import { openLedger } from "./ledger-commands.js";
import { retroCommands } from "./retro-commands.js";

vi.mock("../flow/index.js");
vi.mock("../plan/index.js");
vi.mock("../retro/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../retro/index.js")>()),
  Retro: vi.fn(),
  metricsOf: vi.fn(),
}));
vi.mock("./flow-commands.js");
vi.mock("./ledger-commands.js");

const due = vi.fn();
const record = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  const { ledger } = fakeLedger([{ kind: "outcome" }]);
  vi.mocked(openLedger).mockResolvedValue({ ledger });
  vi.mocked(loadCost).mockResolvedValue({ cost: {} as never });
  vi.mocked(buildReport).mockReturnValue({} as never);
  vi.mocked(metricsOf).mockReturnValue([]);
  vi.mocked(readPlans).mockResolvedValue({});
  vi.mocked(Retro).mockImplementation(function () {
    return { due, record } as unknown as Retro;
  });
});

describe("retro due", () => {
  it("prints the decision as one JSON object with --json", async () => {
    due.mockResolvedValue({
      due: true,
      reason: "count",
      closedIdeas: 5,
      threshold: 5,
      lastRetrospective: "2026-01-01T00:00:00Z",
    });
    const { context, out } = fakeContext({ json: true });
    expect(await retroCommands["due"]?.run(context)).toBe(0);
    expect(out()).toBe(
      '{"due":true,"reason":"count","closedIdeas":5,"threshold":5,"lastRetrospective":"2026-01-01T00:00:00Z"}\n',
    );
  });

  it("says a retro is due and why, in words", async () => {
    due.mockResolvedValue({
      due: true,
      reason: "metric",
      metric: "tokensPerIdea",
      closedIdeas: 2,
      threshold: 5,
      lastRetrospective: null,
    });
    const { context, out } = fakeContext();
    await retroCommands["due"]?.run(context);
    expect(out()).toBe(
      "Retro due: tokensPerIdea worsened (2 of 5 closed ideas since no recorded retro). Run /retro, then `harness retro record --reason metric:tokensPerIdea`.\n",
    );
  });

  it("says nothing is due and exits zero, starting nothing", async () => {
    due.mockResolvedValue({
      due: false,
      closedIdeas: 0,
      threshold: 5,
      lastRetrospective: null,
    });
    const { context, out, deps } = fakeContext();
    const runner = vi.spyOn(deps.runner, "run");
    expect(await retroCommands["due"]?.run(context)).toBe(0);
    expect(out()).toBe(
      "No retro due: 0 of 5 closed ideas since no recorded retro.\n",
    );
    expect(record).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it("builds the metrics from the flow report over the ledger's events", async () => {
    due.mockResolvedValue({
      due: false,
      closedIdeas: 0,
      threshold: 5,
      lastRetrospective: null,
    });
    vi.mocked(metricsOf).mockReturnValue([
      { name: "x", idea: "1", worsened: false },
    ]);
    const { context } = fakeContext();
    await retroCommands["due"]?.run(context);
    expect(due).toHaveBeenCalledWith([
      { name: "x", idea: "1", worsened: false },
    ]);
  });
});

describe("retro record", () => {
  it("refuses a missing --reason with exit 2 and records nothing", async () => {
    const { context, err } = fakeContext();
    expect(await retroCommands["record"]?.run(context)).toBe(2);
    expect(err()).toBe(
      "Missing --reason; run `harness retro record --reason count|manual|metric:<name>`.\n",
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("prints the recorded run as JSON with --json", async () => {
    record.mockResolvedValue({
      reason: "count",
      recordedAt: "2026-01-02T03:04:05Z",
      appended: true,
    });
    const { context, out } = fakeContext({
      json: true,
      options: { reason: "count" },
    });
    expect(await retroCommands["record"]?.run(context)).toBe(0);
    expect(record).toHaveBeenCalledWith("count");
    expect(out()).toBe(
      '{"reason":"count","recordedAt":"2026-01-02T03:04:05Z","appended":true}\n',
    );
  });

  it("reports a refused run as the error's own message, exit 1, as JSON with --json", async () => {
    record.mockRejectedValue(new RetroError("bad reason"));
    const { context, err } = fakeContext({
      json: true,
      options: { reason: "later" },
    });
    expect(await retroCommands["record"]?.run(context)).toBe(1);
    expect(err()).toBe('{"error":"bad reason"}\nbad reason\n');
  });

  it("rethrows a fault that is not a refused run", async () => {
    const fault = new Error("disk");
    record.mockRejectedValue(fault);
    const { context } = fakeContext({ options: { reason: "count" } });
    await expect(retroCommands["record"]?.run(context)).rejects.toBe(fault);
  });
});
