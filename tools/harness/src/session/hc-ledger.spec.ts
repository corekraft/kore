import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { recordTerminalEvent } from "./hc-ledger.js";

vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/ledger.jsonl",
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

const SEND = {
  kind: "session.send" as const,
  pane: "t3",
  agent: "image-trust-writer",
  senderRole: "writer",
  senderName: "pair-a-reader",
};

describe("recordTerminalEvent appends a ledger event written from an hc terminal", () => {
  it("writes the event to the main checkout's ledger with source terminal and the clock's time", async () => {
    expect(await recordTerminalEvent(deps as unknown as CliDeps, SEND)).toBe(
      undefined,
    );

    expect(Ledger).toHaveBeenCalledWith(
      deps.fs,
      deps.clock,
      deps.ids,
      "/repo/.kore/ledger.jsonl",
    );
    expect(append).toHaveBeenCalledWith({
      source: "terminal",
      kind: "session.send",
      occurredAt: "2026-01-02T03:04:05.000Z",
      pane: "t3",
      agent: "image-trust-writer",
      senderRole: "writer",
      senderName: "pair-a-reader",
    });
  });

  it("leaves the sender off when the caller had none, such as the main session", async () => {
    await recordTerminalEvent(deps as unknown as CliDeps, {
      kind: "pane.closed",
      pane: "t3",
      agent: "image-trust-writer",
    });

    expect(append).toHaveBeenCalledWith({
      source: "terminal",
      kind: "pane.closed",
      occurredAt: "2026-01-02T03:04:05.000Z",
      pane: "t3",
      agent: "image-trust-writer",
    });
  });

  it("returns the ledger's reason when it refuses the event, and writes nothing else", async () => {
    append.mockResolvedValue({ ok: false, message: "pane is required" });

    expect(await recordTerminalEvent(deps as unknown as CliDeps, SEND)).toBe(
      "pane is required",
    );
  });

  it("says why when the main checkout cannot be found, and writes nothing", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    expect(await recordTerminalEvent(deps as unknown as CliDeps, SEND)).toBe(
      "cannot find the main checkout to keep the ledger in",
    );
    expect(append).not.toHaveBeenCalled();
  });

  it("rethrows an error that is not a file error", async () => {
    append.mockRejectedValue(new TypeError("bad"));

    await expect(
      recordTerminalEvent(deps as unknown as CliDeps, SEND),
    ).rejects.toThrow("bad");
  });
});
