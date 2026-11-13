import { hostname } from "node:os";
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
  writerIdentity,
} from "./spawn-support.js";

// A live run holds the exclusive host lease at <host>/.kore/locks/host-lease.lock
// (docs/decisions: toil retro item 5). New writers add load the live run cannot afford.

const HOST = "/home/jun";
const LEASE = `${HOST}/.kore/locks/host-lease.lock`;
const lease = (fields: object = {}) =>
  JSON.stringify({
    pid: 4321,
    host: hostname(),
    token: "t",
    acquiredAt: new Date().toISOString(),
    ...fields,
  });
const holder = lease();
const env = { ...INSIDE, HOME: HOST };
const alive = { match: (c: string) => c === "ps", result: { code: 0 } };
const gone = { match: (c: string) => c === "ps", result: { code: 1 } };
const writer = [
  ...spawnArgs.map((arg) => (arg === "reader" ? "writer" : arg)),
  "--worktree",
];
const spawned = [
  ...writerIdentity,
  gitCommon,
  nameFree,
  layoutOf(),
  splitReturns("w3:p9"),
];

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

describe("session spawn when the host lease cannot be judged", () => {
  it("refuses, naming the file to remove, when the lease cannot be parsed", async () => {
    const h = testHarness({
      env,
      files: { [LEASE]: "{torn" },
      responses: spawned,
    });

    expect(await run(writer, h.deps)).not.toBe(0);

    expect(h.err()).toContain(`remove ${LEASE}`);
    expect(herdrCalls(h)).toEqual([]);
  });

  it("refuses when the lease has no usable pid", async () => {
    const h = testHarness({
      env,
      files: { [LEASE]: lease({ pid: "abc" }) },
      responses: spawned,
    });

    expect(await run(writer, h.deps)).not.toBe(0);
    expect(h.err()).toContain(`remove ${LEASE}`);
  });

  it("refuses when ps itself fails, because liveness cannot be proved", async () => {
    const h = testHarness({
      env,
      files: { [LEASE]: holder },
      responses: [
        { match: (c: string) => c === "ps", result: { code: 127 } },
        ...spawned,
      ],
    });

    expect(await run(writer, h.deps)).not.toBe(0);
    expect(h.err()).toContain(`remove ${LEASE}`);
  });

  it("refuses a lease written on another host, which it cannot check", async () => {
    const h = testHarness({
      env,
      files: { [LEASE]: lease({ host: "elsewhere" }) },
      responses: [alive, ...spawned],
    });

    expect(await run(writer, h.deps)).not.toBe(0);
    expect(h.err()).toContain("elsewhere");
    expect(h.err()).toContain(`remove ${LEASE}`);
  });

  it("ignores a lease that predates the host boot, whose pid may be reused", async () => {
    const h = testHarness({
      env,
      files: { [LEASE]: lease({ acquiredAt: "2000-01-01T00:00:00.000Z" }) },
      responses: [alive, ...spawned],
    });

    expect(await run(writer, h.deps)).toBe(0);
  });

  it("treats an empty KORE_HOST_ROOT as unset and refuses a relative one", async () => {
    const empty = testHarness({
      env: { ...INSIDE, HOME: HOST, KORE_HOST_ROOT: "" },
      files: { [LEASE]: holder },
      responses: [alive, ...spawned],
    });
    expect(await run(writer, empty.deps)).not.toBe(0);
    expect(empty.err()).toContain("4321");

    const relative = testHarness({
      env: { ...INSIDE, KORE_HOST_ROOT: "relative/dir" },
      responses: spawned,
    });
    expect(await run(writer, relative.deps)).not.toBe(0);
    expect(relative.err()).toContain("KORE_HOST_ROOT");
  });
});
