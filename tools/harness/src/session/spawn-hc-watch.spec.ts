import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { FakeTerminals } from "../terminal/index.js";
import { LEDGER_WATCH, startLedgerWatch } from "./spawn-hc-watch.js";

vi.mock("./backend.js", () => ({
  hcMessage: vi.fn(
    (error: { error: { message: string } }) => `hc: ${error.error.message}`,
  ),
}));

const WATCH = { bundle: "/main/skills/bin/harness.mjs", main: "/main" };

let deps: FakeDeps;
let terminals: FakeTerminals;

beforeEach(() => {
  deps = fakeDeps();
  terminals = new FakeTerminals();
});

/** A parent terminal the watch can be started under. */
async function startParent(fake: FakeTerminals): Promise<{ id: string }> {
  const started = await fake.run({ argv: ["bash"], cwd: "/w" });
  if ("error" in started) {
    throw new Error(started.error.message);
  }
  return started;
}

describe("startLedgerWatch starts the core's one ledger watch under the parent, outliving it", () => {
  it("names the watch ledger-watch, parents it, and keeps it running after its parent ends", async () => {
    const parent = await startParent(terminals);

    await startLedgerWatch(deps, terminals, { ...WATCH, parent: parent.id });
    terminals.finish(parent.id, 0);

    expect(LEDGER_WATCH).toBe("ledger-watch");
    await expect(terminals.list({ childrenOf: parent.id })).resolves.toEqual([
      {
        id: "t2",
        name: "ledger-watch",
        parent: "t1",
        state: "live",
        labels: {},
        cwd: "/main",
      },
    ]);
    expect(deps.stderr).not.toHaveBeenCalled();
  });

  it("starts nothing new when the watch already runs: a name conflict is not a failure, and prints nothing", async () => {
    const parent = await startParent(terminals);
    await startLedgerWatch(deps, terminals, { ...WATCH, parent: parent.id });

    await startLedgerWatch(deps, terminals, { ...WATCH, parent: parent.id });

    await expect(terminals.list()).resolves.toEqual([
      { id: "t1", state: "live", labels: {}, cwd: "/w" },
      {
        id: "t2",
        name: LEDGER_WATCH,
        parent: "t1",
        state: "live",
        labels: {},
        cwd: "/main",
      },
    ]);
    expect(deps.stderr).not.toHaveBeenCalled();
  });

  it("names any other failure on stderr, with hc's message, and does not throw", async () => {
    await expect(
      startLedgerWatch(deps, terminals, { ...WATCH, parent: "t9" }),
    ).resolves.toBeUndefined();

    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "ledger watch did not start: hc: no terminal t9\n",
    );
  });
});
