import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hcSessionsOn,
  startLedgerWatch,
  terminalsFor,
} from "../session/index.js";
import type { CliDeps } from "../runtime/index.js";
import { depsWith } from "./command-support.js";
import { ensureLedgerWatch } from "./orchestrate-tick-watch.js";

// The flag, the watch and the adapter factory are doubles: their own specs cover them (ADR 0098).
vi.mock("../session/index.js", () => ({
  hcSessionsOn: vi.fn(),
  startLedgerWatch: vi.fn(),
  terminalsFor: vi.fn(),
}));

const MAIN = "/main";
const TERMINALS = { self: vi.fn(() => "t1") };

let deps: CliDeps;

beforeEach(() => {
  vi.clearAllMocks();
  deps = depsWith({});
  vi.mocked(hcSessionsOn).mockResolvedValue(true);
  TERMINALS.self.mockReturnValue("t1");
  vi.mocked(terminalsFor).mockReturnValue(TERMINALS as never);
});

describe("ensureLedgerWatch: when the loop starts the watch", () => {
  it("starts the ledger watch under the loop's own terminal, from the main checkout's bundle", async () => {
    await ensureLedgerWatch(deps, MAIN);
    expect(startLedgerWatch).toHaveBeenCalledWith(deps, TERMINALS, {
      bundle: "/main/skills/bin/harness.mjs",
      main: MAIN,
      parent: "t1",
    });
  });

  it("starts nothing while the hc-sessions flag is off", async () => {
    vi.mocked(hcSessionsOn).mockResolvedValueOnce(false);
    await ensureLedgerWatch(deps, MAIN);
    expect(startLedgerWatch).not.toHaveBeenCalled();
  });

  it("starts nothing outside an hc terminal, since it has no terminal to parent the watch", async () => {
    TERMINALS.self.mockReturnValueOnce(undefined as never);
    await ensureLedgerWatch(deps, MAIN);
    expect(startLedgerWatch).not.toHaveBeenCalled();
  });
});
