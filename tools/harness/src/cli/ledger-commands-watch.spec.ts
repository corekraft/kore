import { beforeEach, describe, expect, it, vi } from "vitest";
import { followTerminals, Ledger } from "../ledger/index.js";
import { HcTerminals } from "../terminal/index.js";
import { mainRoot } from "../runtime/index.js";
import { ledgerCommands } from "./ledger-commands.js";

const NO_ROOT_MESSAGE =
  "Cannot find the main checkout root for the shared ledger. Run inside the repository, set KORE_ROOT to its root, or pass --ledger <path>.";
import { MAIN, ctx } from "./ledger-command-support.js";

// The follow and the main root are doubles: their own specs cover them (ADR 0098).
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  followTerminals: vi.fn(),
}));
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));

const watch = (context: ReturnType<typeof ctx>["context"]) =>
  ledgerCommands["watch"]?.run(context);

beforeEach(() => {
  vi.mocked(mainRoot).mockResolvedValue(MAIN);
});

describe("ledger watch: following hc", () => {
  it("follows hc's terminals into the shared ledger, with an hc adapter", async () => {
    vi.mocked(followTerminals).mockResolvedValueOnce({ ok: true });
    const { context, deps } = ctx();
    expect(await watch(context)).toBe(0);
    expect(followTerminals).toHaveBeenCalledWith({
      ledger: expect.any(Ledger),
      terminals: expect.any(HcTerminals),
      clock: deps.clock,
    });
  });

  it("says in stdout that hc's stream ended, so the watch is started again, and exits 0", async () => {
    vi.mocked(followTerminals).mockResolvedValueOnce({ ok: true });
    const { context, deps } = ctx();
    await watch(context);
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
    expect(await watch(context)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith("hc get failed\n");
  });

  it("refuses with the ledger root message, and follows nothing, when no root can be found", async () => {
    vi.mocked(mainRoot).mockResolvedValueOnce(undefined);
    const { context, deps } = ctx();
    expect(await watch(context)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(NO_ROOT_MESSAGE + "\n");
    expect(followTerminals).not.toHaveBeenCalled();
  });
});
