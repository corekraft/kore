import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GitRevert,
  PrepareRevert,
  revertFlagOn,
  type RevertPorts,
} from "../revert/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { prepareRevertFor } from "./revert-commands.js";

vi.mock("../revert/index.js");

const ROOT = "a-root";
const NOW = new Date("2026-11-14T08:30:00Z");
const done = {
  status: "recorded" as const,
  idea: "0007",
  result: "refuted" as const,
  before: 100,
  after: 130,
  changedByPr: 41,
  concluded: {
    idea: "0007",
    result: "refuted" as const,
    issue: "https://github.com/corekraft/kore/issues/300",
    published: { commented: true, labelled: true, closed: true },
  },
};

function setup(listed: Partial<LedgerEvent>[] = []) {
  const deps = {
    root: vi.fn(() => Promise.resolve(ROOT)),
    runner: { run: vi.fn() },
    clock: { now: vi.fn(() => NOW), sleep: vi.fn() },
    fs: {},
  };
  const fake = fakeLedger(listed);
  const run = vi.fn(() => Promise.resolve({ status: "flag-off" as const }));
  vi.mocked(PrepareRevert).mockImplementation(function () {
    return { run } as never;
  });
  return { deps, fake, run, context: contextWith(deps, {}, false) };
}

function portsOf(): RevertPorts {
  return vi.mocked(PrepareRevert).mock.calls[0]?.[0] as RevertPorts;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("prepareRevertFor", () => {
  it("hands the refuted change to the revert unit and returns its result", async () => {
    const { fake, run, context } = setup();
    const result = await prepareRevertFor(context, fake.ledger, done);
    expect(result).toEqual({ status: "flag-off" });
    expect(run).toHaveBeenCalledWith({
      idea: "0007",
      issue: 300,
      pr: 41,
      result: "refuted",
    });
  });

  it("reads the flag from the local overlay", async () => {
    const { deps, fake, context } = setup();
    vi.mocked(revertFlagOn).mockResolvedValue(true);
    await prepareRevertFor(context, fake.ledger, done);
    expect(await portsOf().flagOn()).toBe(true);
    expect(revertFlagOn).toHaveBeenCalledWith(deps.fs, ROOT);
  });

  it("counts an idea as reverted only when the ledger holds its event", async () => {
    const { fake, context } = setup([{ idea: "0007" }]);
    await prepareRevertFor(context, fake.ledger, done);
    expect(await portsOf().reverted("0007")).toBe(true);
    expect(fake.list).toHaveBeenCalledWith({
      idea: "0007",
      kind: "harness-change-reverted",
    });
  });

  it("is not reverted when the ledger holds no event", async () => {
    const { fake, context } = setup([]);
    await prepareRevertFor(context, fake.ledger, done);
    expect(await portsOf().reverted("0007")).toBe(false);
  });

  it("records the event as a claude harness-change-reverted event with the revert PR number", async () => {
    const { fake, context } = setup();
    await prepareRevertFor(context, fake.ledger, done);
    await portsOf().record("0007", 55);
    expect(fake.write).toHaveBeenCalledWith({
      source: "claude",
      kind: "harness-change-reverted",
      occurredAt: NOW.toISOString(),
      idea: "0007",
      number: 55,
    });
  });

  it("names the ledger's refusal when the event is rejected", async () => {
    const { fake, context } = setup();
    fake.write.mockResolvedValue({ ok: false, message: "bad field" } as never);
    await prepareRevertFor(context, fake.ledger, done);
    await expect(portsOf().record("0007", 55)).rejects.toThrow(
      "The revert PR #55 is open, but its ledger event was rejected: bad field Fix the ledger, then rerun `harness evaluate`.",
    );
  });

  it("builds the git steps on the injected runner, in a temp scratch directory", async () => {
    const { deps, fake, context } = setup();
    await prepareRevertFor(context, fake.ledger, done);
    expect(GitRevert).toHaveBeenCalledWith(
      deps.runner,
      ROOT,
      expect.any(String),
    );
  });
});
