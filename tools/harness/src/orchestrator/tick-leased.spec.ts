import { describe, expect, it, vi } from "vitest";
import type { IdeaStep, Tick } from "./tick.js";
import type { LeaseResult, TickLease } from "./tick-lease.js";
import { leasedPass } from "./tick-leased.js";

const STEPS: IdeaStep[] = [{ idea: "0001", issue: 11, step: "spawn-writer" }];

const lease = (acquired: LeaseResult) =>
  ({
    acquire: vi.fn().mockResolvedValue(acquired),
    release: vi.fn().mockResolvedValue(undefined),
  }) as unknown as TickLease & {
    acquire: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };

const tick = (pass = vi.fn().mockResolvedValue(STEPS)) =>
  ({ pass }) as unknown as Pick<Tick, "pass"> & { pass: typeof pass };

describe("leasedPass", () => {
  it("runs one pass under the lease and releases it", async () => {
    const l = lease({ status: "acquired" });
    const t = tick();

    expect(await leasedPass(l, t, "0001")).toEqual({
      status: "ran",
      steps: STEPS,
    });
    expect(t.pass).toHaveBeenCalledWith("0001");
    expect(l.release).toHaveBeenCalledTimes(1);
  });

  it("names the lease it recovered by age", async () => {
    const from = {
      token: "old",
      pid: 9,
      host: "h",
      acquiredAt: "2026-11-16T10:00:00.000Z",
    };
    const l = lease({ status: "recovered", from });

    expect(await leasedPass(l, tick())).toEqual({
      status: "ran",
      steps: STEPS,
      recovered: from,
    });
  });

  it("runs no pass, and releases nothing, while another tick holds the lease", async () => {
    const holder = {
      token: "other",
      pid: 9,
      host: "h",
      acquiredAt: "2026-11-16T11:59:00.000Z",
    };
    const l = lease({ status: "held", holder });
    const t = tick();

    expect(await leasedPass(l, t)).toEqual({ status: "held", holder });
    expect(t.pass).not.toHaveBeenCalled();
    expect(l.release).not.toHaveBeenCalled();
  });

  it("releases the lease when the pass throws, and rethrows", async () => {
    const l = lease({ status: "acquired" });
    const t = tick(vi.fn().mockRejectedValue(new Error("gh is down")));

    await expect(leasedPass(l, t)).rejects.toThrow("gh is down");
    expect(l.release).toHaveBeenCalledTimes(1);
  });
});
