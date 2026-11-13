import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { run } from "../cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  spawnArgs,
  splitReturns,
} from "./spawn-support.js";

// A live run holds the exclusive host lease at <host>/.kore/locks/host-lease.lock
// (docs/decisions: toil retro item 5). New writers add load the live run cannot afford.

const HOST = "/home/jun";
const LEASE = `${HOST}/.kore/locks/host-lease.lock`;
const holder = JSON.stringify({
  pid: 4321,
  host: "mac",
  token: "t",
  acquiredAt: "2026-01-02T03:00:00.000Z",
});
const env = { ...INSIDE, HOME: HOST };
const alive = { match: (c: string) => c === "ps", result: { code: 0 } };
const gone = { match: (c: string) => c === "ps", result: { code: 1 } };
const writer = [
  ...spawnArgs.map((arg) => (arg === "reader" ? "writer" : arg)),
  "--worktree",
];
const spawned = [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")];

describe("session spawn and the host lease", () => {
  it("refuses a new writer while a live run holds the lease, naming the holder", async () => {
    const h = testHarness({
      env,
      files: { [LEASE]: holder },
      responses: [alive, ...spawned],
    });

    expect(await run(writer, h.deps)).not.toBe(0);

    expect(h.err()).toContain("host lease");
    expect(h.err()).toContain("4321");
    expect(h.err()).toContain("No session was started");
    expect(herdrCalls(h)).toEqual([]);
  });

  it("starts the writer when no live run holds the lease", async () => {
    const h = testHarness({ env, responses: spawned });

    expect(await run(writer, h.deps)).toBe(0);
  });

  it("still starts a reader, which adds no build load", async () => {
    const h = testHarness({
      env,
      files: { [LEASE]: holder },
      responses: [alive, ...spawned],
    });

    expect(await run(spawnArgs, h.deps)).toBe(0);
  });

  it("ignores a lease whose holder process is gone", async () => {
    const h = testHarness({
      env,
      files: { [LEASE]: holder },
      responses: [gone, ...spawned],
    });

    expect(await run(writer, h.deps)).toBe(0);
  });

  it("looks for the lease under KORE_HOST_ROOT when it is set", async () => {
    const h = testHarness({
      env: { ...INSIDE, HOME: "/elsewhere", KORE_HOST_ROOT: HOST },
      files: { [LEASE]: holder },
      responses: [alive, ...spawned],
    });

    expect(await run(writer, h.deps)).not.toBe(0);
  });
});
