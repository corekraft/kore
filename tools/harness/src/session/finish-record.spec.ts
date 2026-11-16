import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "../ledger/index.js";
import { mainRoot } from "../runtime/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { recordFinish } from "./finish-record.js";

vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: vi.fn(),
}));
vi.mock("../runtime/index.js", async (original) => ({
  ...(await original<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));

const append = vi.fn();
let deps: FakeDeps;

beforeEach(() => {
  vi.resetAllMocks();
  deps = fakeDeps();
  vi.mocked(mainRoot).mockResolvedValue("/repo");
  vi.mocked(Ledger).mockImplementation(function () {
    return { record: append } as unknown as Ledger;
  });
  append.mockResolvedValue({ ok: true, event: {} });
});

describe("recordFinish writes pane.finished with the outcome word", () => {
  it("appends a herdr pane.finished for the pane and session name, with only the outcome word", async () => {
    await recordFinish(deps, "w3:p9", "image-trust-writer", "blocked");

    expect(Ledger).toHaveBeenCalledWith(
      deps.fs,
      deps.clock,
      deps.ids,
      "/repo/.kore/state/ledger.jsonl",
    );
    expect(append).toHaveBeenCalledExactlyOnceWith({
      source: "herdr",
      kind: "pane.finished",
      occurredAt: "2026-01-02T03:04:05.000Z",
      pane: "w3:p9",
      agent: "image-trust-writer",
      result: "blocked",
    });
  });

  it("records nothing when the main checkout cannot be found", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await recordFinish(deps, "w3:p9", "image-trust-writer", "done");

    expect(Ledger).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("does not throw when the ledger refuses the event, so the wait still reports the finish", async () => {
    append.mockResolvedValue({ ok: false, message: "Invalid event" });

    await expect(
      recordFinish(deps, "w3:p9", "image-trust-writer", "done"),
    ).resolves.toBeUndefined();
  });

  it("rethrows a failure that is not an I/O error", async () => {
    append.mockRejectedValue(new TypeError("bad input"));

    await expect(
      recordFinish(deps, "w3:p9", "image-trust-writer", "done"),
    ).rejects.toThrow("bad input");
  });
});
