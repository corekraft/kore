import { describe, expect, it, vi } from "vitest";
import type { PassGate } from "./tick-bounds.js";
import { Starts } from "./tick-starts.js";

function gate(): PassGate & { record: ReturnType<typeof vi.fn> } {
  return {
    read: vi.fn(),
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as PassGate & { record: ReturnType<typeof vi.fn> };
}

describe("Starts with a hold", () => {
  it("holds every start the pass makes, and records the hold for the issue it held", async () => {
    const g = gate();
    const starts = new Starts({ saver: false, hold: "load" }, g);

    expect(await starts.admit(11)).toBe("load");
    expect(await starts.admit(12)).toBe("load");
    expect(g.record).toHaveBeenCalledWith(11, "load");
    expect(g.record).toHaveBeenCalledWith(12, "load");
  });
});

describe("Starts on battery", () => {
  it("lets one start through, then holds the next as saver mode and records it", async () => {
    const g = gate();
    const starts = new Starts({ saver: true }, g);

    expect(await starts.admit(11)).toBeUndefined();
    expect(await starts.admit(12)).toBe("saver");
    expect(g.record).toHaveBeenCalledTimes(1);
    expect(g.record).toHaveBeenCalledWith(12, "saver");
  });

  it("counts a start taken by hand, so saver mode holds the next one", async () => {
    const starts = new Starts({ saver: true }, gate());

    starts.taken();

    expect(await starts.admit(11)).toBe("saver");
  });
});

describe("Starts on AC power with no hold", () => {
  it("lets every start through and records none", async () => {
    const g = gate();
    const starts = new Starts({ saver: false }, g);

    expect(await starts.admit(11)).toBeUndefined();
    expect(await starts.admit(12)).toBeUndefined();
    expect(g.record).not.toHaveBeenCalled();
  });
});
