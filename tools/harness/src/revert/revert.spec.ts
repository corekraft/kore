import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrepareRevert, type RevertPorts, type RevertPr } from "./revert.js";

const change = { idea: "0007", issue: 300, pr: 41 };

function ports() {
  const fake = {
    flagOn: vi.fn(() => Promise.resolve(true)),
    reverted: vi.fn(() => Promise.resolve(false)),
    existing: vi.fn(() => Promise.resolve<RevertPr | undefined>(undefined)),
    touchesGuardrail: vi.fn(() => Promise.resolve(false)),
    prepare: vi.fn(() =>
      Promise.resolve({ number: 55, url: "https://github.com/o/r/pull/55" }),
    ),
    record: vi.fn(() => Promise.resolve()),
  };
  const asPorts: RevertPorts = fake;
  return { fake, revert: new PrepareRevert(asPorts) };
}

function touched(fake: ReturnType<typeof ports>["fake"]) {
  return [fake.prepare, fake.record, fake.existing, fake.flagOn].some(
    (m) => m.mock.calls.length > 0,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PrepareRevert", () => {
  it.each(["confirmed", "inconclusive"] as const)(
    "never reverts a %s outcome and touches nothing",
    async (result) => {
      const { fake, revert } = ports();
      expect(await revert.run({ ...change, result })).toEqual({
        status: "not-refuted",
      });
      expect(touched(fake)).toBe(false);
    },
  );

  it("prepares nothing while the flag is off", async () => {
    const { fake, revert } = ports();
    fake.flagOn.mockResolvedValue(false);
    expect(await revert.run({ ...change, result: "refuted" })).toEqual({
      status: "flag-off",
    });
    expect(fake.prepare).not.toHaveBeenCalled();
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("prepares one revert for a refuted idea and records its ledger event", async () => {
    const { fake, revert } = ports();
    expect(await revert.run({ ...change, result: "refuted" })).toEqual({
      status: "prepared",
      number: 55,
      url: "https://github.com/o/r/pull/55",
    });
    expect(fake.prepare).toHaveBeenCalledWith(change);
    expect(fake.record).toHaveBeenCalledWith("0007", 55);
  });
});

describe("PrepareRevert reruns and refusals", () => {
  it("never prepares a second revert once the ledger holds the event", async () => {
    const { fake, revert } = ports();
    fake.reverted.mockResolvedValue(true);
    expect(await revert.run({ ...change, result: "refuted" })).toEqual({
      status: "already-reverted",
    });
    expect(fake.prepare).not.toHaveBeenCalled();
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("adopts a revert PR that exists without an event instead of opening another", async () => {
    const { fake, revert } = ports();
    fake.existing.mockResolvedValue({
      number: 56,
      url: "https://github.com/o/r/pull/56",
    });
    expect(await revert.run({ ...change, result: "refuted" })).toEqual({
      status: "already-prepared",
      number: 56,
      url: "https://github.com/o/r/pull/56",
    });
    expect(fake.prepare).not.toHaveBeenCalled();
    expect(fake.record).toHaveBeenCalledWith("0007", 56);
  });

  it("leaves a change that touched a guardrail to the guardrail request path", async () => {
    const { fake, revert } = ports();
    fake.touchesGuardrail.mockResolvedValue(true);
    expect(await revert.run({ ...change, result: "refuted" })).toEqual({
      status: "guardrail",
    });
    expect(fake.touchesGuardrail).toHaveBeenCalledWith(41);
    expect(fake.prepare).not.toHaveBeenCalled();
  });

  it("records no event when the revert could not be prepared", async () => {
    const { fake, revert } = ports();
    fake.prepare.mockRejectedValue(new Error("conflict"));
    await expect(revert.run({ ...change, result: "refuted" })).rejects.toThrow(
      "conflict",
    );
    expect(fake.record).not.toHaveBeenCalled();
  });
});
