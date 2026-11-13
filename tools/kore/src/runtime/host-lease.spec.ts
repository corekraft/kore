import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { HOST_LEASE, holdsHostLease, withHostLease } from "./host-lease.js";
import { HELD_LOCK_ENV } from "./lock.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

let host: string;
let previous: string | undefined;

beforeEach(async () => {
  host = await mkdtemp(join(tmpdir(), "kore-lease-"));
  previous = process.env.KORE_HOST_ROOT;
  process.env.KORE_HOST_ROOT = host;
});

afterEach(async () => {
  delete process.env[HELD_LOCK_ENV];
  if (previous === undefined) {
    delete process.env.KORE_HOST_ROOT;
  } else {
    process.env.KORE_HOST_ROOT = previous;
  }
  await rm(host, { recursive: true, force: true });
});

test("a process holds the lease only while it is inside withHostLease", async () => {
  expect(await holdsHostLease()).toBe(false);
  await withHostLease(async () => {
    expect(await holdsHostLease()).toBe(true);
  });
  expect(await holdsHostLease()).toBe(false);
});

test("a lease another process holds is not ours, even when we know its name", async () => {
  await mkdir(join(host, ".kore", "locks"), { recursive: true });
  await writeFile(
    join(host, ".kore", "locks", `${HOST_LEASE}.lock`),
    JSON.stringify({
      pid: process.pid + 1,
      host: hostname(),
      token: "theirs",
      acquiredAt: new Date().toISOString(),
    }),
  );

  expect(await holdsHostLease()).toBe(false);
});
