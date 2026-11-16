import { describe, expect, it, vi } from "vitest";
import {
  TICK_LEASE_MAX_AGE_MS,
  TickLease,
  type LeaseRecord,
  type LeaseStore,
} from "./tick-lease.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const MINUTE = 60 * 1000;

const holder = (ageMs: number, token = "other"): LeaseRecord => ({
  token,
  pid: 4242,
  host: "this-machine",
  acquiredAt: new Date(NOW.getTime() - ageMs).toISOString(),
});

type Mocked = { [K in keyof LeaseStore]: ReturnType<typeof vi.fn> };

function store(over: Partial<Mocked> = {}): Mocked {
  return {
    read: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(true),
    overwrite: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const lease = (s: Mocked) =>
  new TickLease(s as unknown as LeaseStore, () => NOW, "mine", {
    pid: 1,
    host: "this-machine",
  });

describe("TickLease", () => {
  it("is acquired when nobody holds it, written with this tick's token, pid, host and time", async () => {
    const s = store();

    expect(await lease(s).acquire()).toEqual({ status: "acquired" });
    expect(s.create).toHaveBeenCalledWith({
      token: "mine",
      pid: 1,
      host: "this-machine",
      acquiredAt: NOW.toISOString(),
    });
    expect(s.overwrite).not.toHaveBeenCalled();
  });

  it("is refused while a younger lease is held, and the holder's record is left alone", async () => {
    const young = holder(TICK_LEASE_MAX_AGE_MS - MINUTE);
    const s = store({
      create: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockResolvedValue(young),
    });

    expect(await lease(s).acquire()).toEqual({
      status: "held",
      holder: young,
    });
    expect(s.overwrite).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("is recovered by age: a lease at the age limit is taken over, and the old holder is named", async () => {
    const old = holder(TICK_LEASE_MAX_AGE_MS);
    const read = vi
      .fn()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce({ ...old, token: "mine" });
    const s = store({ create: vi.fn().mockResolvedValue(false), read });

    expect(await lease(s).acquire()).toEqual({
      status: "recovered",
      from: old,
    });
    expect(s.overwrite).toHaveBeenCalledWith({
      token: "mine",
      pid: 1,
      host: "this-machine",
      acquiredAt: NOW.toISOString(),
    });
  });
});

describe("TickLease when ticks collide", () => {
  it("is refused when another tick recovers the same old lease first", async () => {
    const old = holder(TICK_LEASE_MAX_AGE_MS + MINUTE);
    const winner = holder(0, "winner");
    const read = vi
      .fn()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(winner);
    const s = store({ create: vi.fn().mockResolvedValue(false), read });

    expect(await lease(s).acquire()).toEqual({
      status: "held",
      holder: winner,
    });
  });

  it("is refused when the lease vanishes between the failed create and the read", async () => {
    const s = store({
      create: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockResolvedValue(undefined),
    });

    expect(await lease(s).acquire()).toEqual({ status: "held" });
  });

  it("is released only when it still carries this tick's token", async () => {
    const mine = store({
      read: vi.fn().mockResolvedValue(holder(0, "mine")),
    });
    await lease(mine).release();
    expect(mine.remove).toHaveBeenCalledTimes(1);

    const taken = store({
      read: vi.fn().mockResolvedValue(holder(0, "somebody-else")),
    });
    await lease(taken).release();
    expect(taken.remove).not.toHaveBeenCalled();
  });
});
