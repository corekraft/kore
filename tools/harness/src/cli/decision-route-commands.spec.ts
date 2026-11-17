import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DecisionError,
  decisionFlagOn,
  routeQuestion,
  type Routed,
  type RoutePorts,
} from "../decision/index.js";
import { IdeaRepository } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { routeCommands } from "./decision-route-commands.js";
import { openLedger } from "./ledger-commands.js";

vi.mock("../decision/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../decision/index.js")>()),
  decisionFlagOn: vi.fn(),
  routeQuestion: vi.fn(),
}));
vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  IdeaRepository: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const ROOT = "/repo";
const FLAGS = {
  idea: "8",
  category: "naming",
  question: "Median or P50?",
  action: "Rename to Median.",
};
const ROUTED: Routed = {
  idea: "0008",
  category: "naming",
  route: "advisor",
  signal: "agreed",
};

function fakeDeps() {
  return {
    root: vi.fn(() => Promise.resolve(ROOT)),
    runner: { run: vi.fn() },
    clock: {
      now: vi.fn(() => new Date("2026-11-17T10:00:00Z")),
      sleep: vi.fn(() => Promise.resolve()),
    },
    fs: {},
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
    env: {},
  };
}

function context(options: Record<string, string | boolean>, json = false) {
  const deps = fakeDeps();
  return { ctx: contextWith(deps, options, json), deps };
}

/** The ports the command handed to routeQuestion. */
function portsOf(): RoutePorts {
  return vi.mocked(routeQuestion).mock.calls[0]?.[0] as RoutePorts;
}

const route = routeCommands["route"];

beforeEach(() => {
  vi.mocked(routeQuestion).mockResolvedValue(ROUTED);
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
});

describe("decision route", () => {
  it("routes the question from the flags and says where it went", async () => {
    const { ctx, deps } = context(FLAGS);

    expect(await route?.run(ctx)).toBe(0);

    expect(routeQuestion).toHaveBeenCalledWith(expect.anything(), {
      idea: "8",
      category: "naming",
      question: "Median or P50?",
      action: "Rename to Median.",
      escalate: false,
    });
    expect(deps.stdout).toHaveBeenCalledWith(
      "Routed to the advisor for idea 0008 (signal: agreed).\n",
    );
  });

  it("tells the pane to ask the owner on the idea's issue when the route is the owner's", async () => {
    vi.mocked(routeQuestion).mockResolvedValue({
      ...ROUTED,
      route: "owner",
      signal: "matched",
    });
    const { ctx, deps } = context(FLAGS);

    await route?.run(ctx);

    expect(deps.stdout).toHaveBeenCalledWith(
      "Routed to the owner for idea 0008 (signal: matched): ask the owner on the idea's issue.\n",
    );
  });

  it("passes --escalate on as the advisor's escalation", async () => {
    const { ctx } = context({ ...FLAGS, escalate: true });

    await route?.run(ctx);

    expect(routeQuestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ escalate: true }),
    );
  });

  it("prints the routed question as one JSON line with --json", async () => {
    const { ctx, deps } = context(FLAGS, true);

    await route?.run(ctx);

    expect(deps.stdout).toHaveBeenCalledWith(`${JSON.stringify(ROUTED)}\n`);
  });

  it("refuses a route with no --idea before anything is routed or recorded", async () => {
    const { ctx, deps } = context({ ...FLAGS, idea: "" });

    expect(await route?.run(ctx)).toBe(2);

    expect(routeQuestion).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledWith(
      expect.stringContaining("Missing --idea; run `harness decision route"),
    );
  });

  it("prints a refusal, such as the flag being off, and exits 1 without a stack trace", async () => {
    vi.mocked(routeQuestion).mockRejectedValue(
      new DecisionError("The decision-advisor flag is off."),
    );
    const { ctx, deps } = context(FLAGS);

    expect(await route?.run(ctx)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The decision-advisor flag is off.\n",
    );
  });

  it("rethrows an error it does not expect", async () => {
    vi.mocked(routeQuestion).mockRejectedValue(new Error("disk full"));
    const { ctx } = context(FLAGS);

    await expect(route?.run(ctx)).rejects.toThrow("disk full");
  });
});

describe("decision route ports", () => {
  it("resolves the idea to its number from its record, and calls no gh", async () => {
    const get = vi.fn(() => Promise.resolve({ number: "0008" }));
    vi.mocked(IdeaRepository).mockImplementation(function () {
      return { get } as unknown as IdeaRepository;
    });
    const { ctx, deps } = context(FLAGS);

    await route?.run(ctx);

    expect(await portsOf().idea("8")).toBe("0008");
    expect(get).toHaveBeenCalledWith("8");
    expect(IdeaRepository).toHaveBeenCalledWith(deps.fs, deps.clock, ROOT);
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("reads the flag from the local overlay", async () => {
    vi.mocked(decisionFlagOn).mockResolvedValue(false);
    const { ctx, deps } = context(FLAGS);

    await route?.run(ctx);

    expect(await portsOf().flagOn()).toBe(false);
    expect(decisionFlagOn).toHaveBeenCalledWith(deps.fs, ROOT);
  });

  it("records decision.routed from claude with the idea, label, route and signal, and no question text", async () => {
    const ledger = fakeLedger([], { ok: true, event: {} as LedgerEvent });
    vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
    const { ctx } = context(FLAGS);

    await route?.run(ctx);
    const recorded = await portsOf().record({
      idea: "0008",
      label: "naming",
      route: "advisor",
      signal: "agreed",
    });

    expect(recorded).toEqual({ ok: true });
    expect(ledger.write).toHaveBeenCalledWith({
      source: "claude",
      kind: "decision.routed",
      occurredAt: "2026-11-17T10:00:00.000Z",
      idea: "0008",
      label: "naming",
      route: "advisor",
      signal: "agreed",
    });
  });

  it("passes the ledger's rejection back as a message, so the route is not recorded", async () => {
    const ledger = fakeLedger([], {
      ok: false,
      field: "label",
      message: "is required on decision.routed events",
    });
    vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
    const { ctx } = context(FLAGS);

    await route?.run(ctx);
    const recorded = await portsOf().record({
      idea: "0008",
      label: "naming",
      route: "owner",
      signal: "matched",
    });

    expect(recorded).toEqual({
      ok: false,
      message: "is required on decision.routed events",
    });
  });
});
