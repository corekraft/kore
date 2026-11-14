// Fixtures for lock.spec.ts: the lock's paths, clock, owner records and judge
// verdicts. Data only, so it needs no spec of its own (ADR 0098).
import type { LockOwner } from "./lock-owner.js";
import type { Verdict } from "./lock-recovery.js";

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
export const GONE: Verdict = {
  dead: false,
  reason: "gone",
  fix: "Retry.",
  gone: true,
};
export const LIVE_HOLDER: Verdict = {
  dead: false,
  reason: "held by running pid 7",
  fix: "Wait.",
  live: true,
};
