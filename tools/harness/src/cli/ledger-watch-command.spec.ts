import { beforeEach, describe, expect, it, vi } from "vitest";
import { followTerminals, type Ledger } from "../ledger/index.js";
import { terminalsFor } from "../session/index.js";
import { ctx } from "./ledger-command-support.js";
import { watchCommand, type OpenLedger } from "./ledger-watch-command.js";

// The follow and the adapter factory are doubles: their own specs cover them (ADR 0098).
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  followTerminals: vi.fn(),
}));
vi.mock("../session/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session/index.js")>()),
  terminalsFor: vi.fn(),
}));

const LEDGER = { path: "/main/ledger" } as unknown as Ledger;
const ADAPTER = { get: vi.fn() };

/** An opener that opens the ledger, as the ledger commands' own does. */
const opening: OpenLedger = vi.fn(async () => ({ ledger: LEDGER }));

beforeEach(() => {
  vi.mocked(terminalsFor).mockReturnValue(ADAPTER as never);
});

describe("ledger watch: following hc", () => {
  it("follows hc's terminals into the opened ledger, through the shared adapter factory", async () => {
    vi.mocked(followTerminals).mockResolvedValueOnce({ ok: true });
    const { context, deps } = ctx();
    expect(await watchCommand(opening).run(context)).toBe(0);
    expect(terminalsFor).toHaveBeenCalledWith(deps);
    expect(followTerminals).toHaveBeenCalledWith({
      ledger: LEDGER,
      terminals: ADAPTER,
      clock: deps.clock,
    });
  });

  it("says in stdout that hc's stream ended, so the watch is started again, and exits 0", async () => {
    vi.mocked(followTerminals).mockResolvedValueOnce({ ok: true });
    const { context, deps } = ctx();
    await watchCommand(opening).run(context);
    expect(deps.stdout).toHaveBeenCalledWith(
      "hc events ended: the ledger watch stopped; start it again to resume\n",
    );
  });

  it("names the failure on stderr and exits 1 when the follow fails", async () => {
    vi.mocked(followTerminals).mockResolvedValueOnce({
      ok: false,
      message: "hc get failed",
    });
    const { context, deps } = ctx();
    expect(await watchCommand(opening).run(context)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith("hc get failed\n");
  });
});

describe("ledger watch: a ledger that will not open", () => {
  it("names the opener's message on stderr, and follows nothing", async () => {
    const refused: OpenLedger = vi.fn(async () => ({
      error: "no ledger root",
    }));
    const { context, deps } = ctx();
    expect(await watchCommand(refused).run(context)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith("no ledger root\n");
    expect(followTerminals).not.toHaveBeenCalled();
  });
});
