import { readFileSync, rmSync } from "node:fs";
import { link, mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processAlive, readOwner } from "./lock-owner.js";
import { judge, recover, refusal } from "./lock-recovery.js";
import {
  HELD_LOCK_ENV,
  holdEnvironmentLock,
  withEnvironmentLock,
  type LockOptions,
} from "./lock.js";
import {
  CLOCK,
  DEAD,
  LOCK,
  OWNER,
  RECOVERY,
  ROOT,
  STAGING,
  TOKEN,
  installLockDefaults,
} from "./lock-support.js";
import { systemError, type FakeHandle } from "./runtime-support.js";

vi.mock("node:crypto");
vi.mock("node:fs");
vi.mock("node:fs/promises");
vi.mock("node:os");
vi.mock("node:path");
vi.mock("./lock-owner.js");
vi.mock("./lock-recovery.js");

let handle: FakeHandle;

function options(extra: LockOptions = {}): LockOptions {
  return { onRecover: vi.fn(), onWait: vi.fn(), ...extra };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(CLOCK));
  vi.spyOn(process, "once").mockImplementation(() => process);
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  handle = installLockDefaults();
  delete process.env[HELD_LOCK_ENV];
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env[HELD_LOCK_ENV];
});

describe("holdEnvironmentLock", () => {
  it("stages the owner record and links it into place, so the lock appears with its owner", async () => {
    await holdEnvironmentLock(ROOT, "local");

    expect(open).toHaveBeenCalledWith(STAGING, "wx");
    expect(handle.writeFile).toHaveBeenCalledWith(JSON.stringify(OWNER));
    expect(link).toHaveBeenCalledWith(STAGING, LOCK);
    expect(rm).toHaveBeenCalledWith(STAGING, { force: true });
  });

  it("creates the locks directory, recursively, before taking the lock", async () => {
    await holdEnvironmentLock(ROOT, "local");

    expect(mkdir).toHaveBeenCalledWith("/root/.kore/locks", {
      recursive: true,
    });
  });

  it("exports its token after any token the caller inherited, for child kore processes", async () => {
    process.env[HELD_LOCK_ENV] = "host-lease:abc";

    await holdEnvironmentLock(ROOT, "local");

    expect(process.env[HELD_LOCK_ENV]).toBe(`host-lease:abc,local:${TOKEN}`);
  });

  it("releases the lock while its token owns it, and restores the exported environment", async () => {
    const held = await holdEnvironmentLock(ROOT, "local");

    await held.release();

    expect(rm).toHaveBeenCalledWith(LOCK, { force: true });
    expect(process.env[HELD_LOCK_ENV]).toBeUndefined();
  });

  it("leaves a lock that another owner has taken in place, and releases once only", async () => {
    const held = await holdEnvironmentLock(ROOT, "local");
    vi.mocked(readOwner).mockResolvedValue({ ...OWNER, token: "other" });

    await held.release();
    await held.release();

    expect(rm).not.toHaveBeenCalledWith(LOCK, expect.anything());
  });

  it("removes the lock synchronously on exit while its token owns it, and never another's", async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(OWNER));
    const held = await holdEnvironmentLock(ROOT, "local");
    held.releaseSync();
    expect(rmSync).toHaveBeenCalledWith(LOCK, { force: true });

    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...OWNER, token: "other" }),
    );
    vi.mocked(rmSync).mockClear();
    held.releaseSync();
    expect(rmSync).not.toHaveBeenCalled();
  });

  it("rethrows a failure to create the lock that is not an existing lock", async () => {
    const denied = systemError("EACCES");
    vi.mocked(link).mockRejectedValue(denied);

    await expect(holdEnvironmentLock(ROOT, "local")).rejects.toBe(denied);
  });

  it("probes liveness with kill(pid, 0) and dates the boot from the clock minus uptime by default", async () => {
    vi.mocked(link).mockRejectedValueOnce(systemError("EEXIST"));
    vi.mocked(judge).mockResolvedValueOnce({
      dead: false,
      reason: "x",
      fix: "y",
      gone: true,
    });

    await holdEnvironmentLock(ROOT, "local");

    const probes = vi.mocked(judge).mock.calls[0]![1];
    expect(probes.isAlive).toBe(processAlive);
    expect(probes.bootTime()).toBe(Date.parse(CLOCK) - 1000 * 1000);
  });
});

describe("waiting for a live holder", () => {
  beforeEach(() => {
    vi.mocked(judge).mockResolvedValue({
      dead: false,
      reason: "held by running pid 7",
      fix: "Wait.",
      live: true,
    });
    vi.mocked(link).mockRejectedValue(systemError("EEXIST"));
  });

  it("announces who it waits for, where, and for how long, then takes the lock once released", async () => {
    vi.mocked(readOwner).mockResolvedValue({ ...OWNER, cwd: "/work/other" });
    vi.mocked(link)
      .mockRejectedValueOnce(systemError("EEXIST"))
      .mockResolvedValue(undefined);
    const opts = options({ waitMs: 60_000, pollMs: 10 });

    const pending = holdEnvironmentLock(ROOT, "local", opts);
    await vi.runAllTimersAsync();
    await pending;

    expect(opts.onWait).toHaveBeenCalledTimes(1);
    expect(opts.onWait).toHaveBeenCalledWith(
      `waiting for local: held by running pid 7 in /work/other (lock ${LOCK}); waiting up to 60000 ms`,
    );
  });

  it("refuses a holder that outlasts the wait, naming the holder and the wait", async () => {
    const failure = holdEnvironmentLock(
      ROOT,
      "local",
      options({ waitMs: 50, pollMs: 10 }),
    ).catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();

    expect(await failure).toEqual(new Error("refused"));
    expect(refusal).toHaveBeenCalledWith(
      "local",
      LOCK,
      "held by running pid 7; waited 50 ms",
      "Wait.",
    );
  });

  it("refuses a live holder at once when no wait was asked for", async () => {
    await expect(holdEnvironmentLock(ROOT, "local")).rejects.toThrow("refused");

    expect(refusal).toHaveBeenCalledWith(
      "local",
      LOCK,
      "held by running pid 7",
      "Wait.",
    );
  });
});

describe("recovering a stale lock", () => {
  it("recovers a dead owner's lock and announces the owner and the interrupted mutation", async () => {
    vi.mocked(link).mockRejectedValueOnce(systemError("EEXIST"));
    vi.mocked(judge).mockResolvedValue({ dead: true, owner: DEAD });
    vi.mocked(recover).mockResolvedValue(DEAD);
    const opts = options();

    await holdEnvironmentLock(ROOT, "local", opts);

    expect(recover).toHaveBeenCalledWith(
      { lock: LOCK, recovery: RECOVERY },
      expect.objectContaining({ isAlive: processAlive }),
    );
    expect(opts.onRecover).toHaveBeenCalledWith(
      `recovered stale lock ${LOCK} left by pid 424242 (acquired 2026-11-13T00:00:00.000Z); the previous mutation was interrupted, so check \`kore journal\` before trusting the environment state`,
    );
  });

  it("retries at once when the lock vanished between the attempt and its inspection", async () => {
    vi.mocked(link).mockRejectedValueOnce(systemError("EEXIST"));
    vi.mocked(judge).mockResolvedValueOnce({
      dead: false,
      reason: "gone",
      fix: "Retry.",
      gone: true,
    });

    await holdEnvironmentLock(ROOT, "local");

    expect(recover).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("refuses when another process takes the recovery lock first, naming the recovery lock", async () => {
    vi.mocked(link).mockRejectedValue(systemError("EEXIST"));
    vi.mocked(judge).mockResolvedValue({ dead: true, owner: DEAD });
    vi.mocked(recover).mockResolvedValue(undefined);

    await expect(holdEnvironmentLock(ROOT, "local")).rejects.toThrow("refused");
    expect(refusal).toHaveBeenCalledWith(
      "local",
      LOCK,
      "another process is recovering or has just taken it",
      `Retry shortly; if it persists, check ${RECOVERY} and ${LOCK}.`,
    );
  });

  it("refuses a lock whose owner cannot be proven dead, without recovering it", async () => {
    vi.mocked(link).mockRejectedValue(systemError("EEXIST"));
    vi.mocked(judge).mockResolvedValue({
      dead: false,
      reason: "legacy",
      fix: "rm it",
    });

    await expect(holdEnvironmentLock(ROOT, "local")).rejects.toThrow("refused");
    expect(recover).not.toHaveBeenCalled();
    expect(refusal).toHaveBeenCalledWith("local", LOCK, "legacy", "rm it");
  });
});

describe("inheriting and withEnvironmentLock", () => {
  it("runs the operation without a second lock when the caller already holds it", async () => {
    process.env[HELD_LOCK_ENV] = `local:${TOKEN}`;
    const operation = vi.fn(async () => "done");

    await expect(withEnvironmentLock(ROOT, "local", operation)).resolves.toBe(
      "done",
    );

    expect(link).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not inherit a token for another environment, nor one that no longer owns the lock", async () => {
    process.env[HELD_LOCK_ENV] = `host-lease:${TOKEN}`;
    await withEnvironmentLock(ROOT, "local", async () => undefined);
    expect(link).toHaveBeenCalledTimes(1);

    process.env[HELD_LOCK_ENV] = "local:stale-token";
    await withEnvironmentLock(ROOT, "local", async () => undefined);
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("takes the lock around the operation, and releases it even when the operation fails", async () => {
    const failure = new Error("operation failed");

    await expect(
      withEnvironmentLock(ROOT, "local", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(rm).toHaveBeenCalledWith(LOCK, { force: true });
  });

  it("does not export its token, so concurrent operations in this process still exclude each other", async () => {
    let exported: string | undefined = "unset";

    await withEnvironmentLock(ROOT, "local", async () => {
      exported = process.env[HELD_LOCK_ENV];
    });

    expect(exported).toBeUndefined();
  });
});
