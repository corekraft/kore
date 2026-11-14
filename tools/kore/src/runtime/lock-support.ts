// Fixtures and fakes for lock.spec.ts: the lock's paths, owner and clock, and the
// defaults its mocked file system and owner helpers answer with. Not a unit, so it
// needs no spec of its own (ADR 0098).
import { randomUUID } from "node:crypto";
import { link, open } from "node:fs/promises";
import { hostname, uptime } from "node:os";
import { vi } from "vitest";
import { errorCode, readOwner, type LockOwner } from "./lock-owner.js";
import { judge, refusal } from "./lock-recovery.js";
import { fakeHandle, type FakeHandle } from "./runtime-support.js";

export const ROOT = "/root";
export const TOKEN = "00000000-0000-4000-8000-000000000001";
export const LOCK = "/root/.kore/locks/local.lock";
export const RECOVERY = `${LOCK}.recovery`;
export const STAGING = `/root/.kore/locks/local.${TOKEN}.tmp`;
export const CLOCK = "2026-11-14T00:00:00.000Z";
export const OWNER: LockOwner = {
  pid: process.pid,
  host: "box",
  token: TOKEN,
  acquiredAt: CLOCK,
  cwd: process.cwd(),
};
export const DEAD: LockOwner = {
  ...OWNER,
  pid: 424242,
  acquiredAt: "2026-11-13T00:00:00.000Z",
};

/**
 * Answers the mocked modules with the defaults of a clean take: the link
 * succeeds at once, the lock is ours, and a failed attempt is refused. Returns
 * the open file handle the take writes its owner record to.
 */
export function installLockDefaults(): FakeHandle {
  vi.mocked(randomUUID).mockReturnValue(TOKEN);
  vi.mocked(hostname).mockReturnValue("box");
  vi.mocked(uptime).mockReturnValue(1000);
  vi.mocked(errorCode).mockImplementation(
    (error) => (error as NodeJS.ErrnoException).code,
  );
  const handle = fakeHandle();
  vi.mocked(open).mockResolvedValue(handle.handle);
  vi.mocked(link).mockResolvedValue(undefined);
  vi.mocked(readOwner).mockResolvedValue(OWNER);
  vi.mocked(judge).mockResolvedValue({ dead: false, reason: "x", fix: "y" });
  vi.mocked(refusal).mockImplementation(() => new Error("refused"));
  return handle;
}
