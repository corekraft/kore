import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { FakeTerminals, type TerminalError } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import { closeOnHc } from "./close-hc.js";
import { recordTerminalEvent } from "./hc-ledger.js";
import {
  asRegistry,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import type { SessionRecord } from "./registry.js";

vi.mock("./hc-ledger.js", () => ({ recordTerminalEvent: vi.fn() }));
vi.mock("./backend.js", () => ({
  hcMessage: vi.fn((error: TerminalError) => error.error.message),
}));

const NOW = "2026-01-02T03:04:05.000Z";
const STARTING: SessionRecord = {
  version: 1,
  backend: "hc",
  name: "image-trust-writer",
  paneId: "",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: NOW,
  starting: true,
};
const NO_RESULT: SessionRecord = {
  version: 1,
  backend: "hc",
  name: "image-trust-writer",
  paneId: "t2",
  terminal: "t2",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: NOW,
};

let deps: FakeDeps;
let registry: FakeRegistry;

const close = (terminals: FakeTerminals, record: SessionRecord) =>
  closeOnHc(
    deps as unknown as CliDeps,
    terminals,
    asRegistry(registry),
    record,
  );

/** t1 is the caller; t2 is its child, the writer the record names. */
async function world(self: string | undefined): Promise<FakeTerminals> {
  const terminals = new FakeTerminals(self === undefined ? {} : { self });
  await terminals.run({ argv: ["claude"], cwd: "/main" });
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/writer",
    name: "image-trust-writer",
    parent: "t1",
  });
  return terminals;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hcMessage).mockImplementation(
    (error: TerminalError) => error.error.message,
  );
  deps = fakeDeps();
  registry = fakeRegistry();
  vi.mocked(recordTerminalEvent).mockResolvedValue(undefined);
  registry.write.mockResolvedValue(undefined);
});

describe("closeOnHc clears a record whose start never got a terminal", () => {
  it("marks it closed as blocked, killing, recording and removing nothing, since there is no terminal", async () => {
    const terminals = await world("t1");
    const kill = vi.spyOn(terminals, "kill");
    const remove = vi.spyOn(terminals, "remove");

    expect(await close(terminals, STARTING)).toStrictEqual({ closedAt: NOW });

    expect(registry.write).toHaveBeenCalledExactlyOnceWith({
      ...STARTING,
      closedAt: NOW,
      result: {
        outcome: "blocked",
        at: NOW,
        summary: "never started a terminal",
      },
    });
    expect(kill).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(recordTerminalEvent).not.toHaveBeenCalled();
  });

  it("refuses it, writing nothing, when the caller is not inside an hc terminal", async () => {
    expect(await close(await world(undefined), STARTING)).toStrictEqual({
      error:
        "Not inside an hc terminal (HC_TERMINAL_ID is unset), so session close image-trust-writer was not run. Run it from the terminal that spawned the session.",
    });
    expect(registry.write).not.toHaveBeenCalled();
  });
});

describe("closeOnHc keeps the result gate when hc no longer has the terminal", () => {
  it("refuses a record with no recorded result or report, writing nothing", async () => {
    const terminals = await world("t1");
    await terminals.kill("t2");
    await terminals.remove("t2");

    expect(await close(terminals, NO_RESULT)).toStrictEqual({
      error:
        "Session image-trust-writer has no recorded result, so terminal t2 stays open. Run `session wait image-trust-writer` first.",
    });
    expect(registry.write).not.toHaveBeenCalled();
  });
});
