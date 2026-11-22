import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ledger, LedgerEvent } from "../ledger/index.js";
import type { CommandContext, Runner } from "../runtime/index.js";
import { openJudgeLedger } from "./judge-shared.js";
import { sessionResampleIo } from "./review-resample-io.js";

vi.mock("../judge/index.js", () => {
  class ErrorStandIn extends Error {}
  return { JudgeError: ErrorStandIn };
});
vi.mock("./judge-shared.js", () => ({
  openJudgeLedger: vi.fn<(context: CommandContext) => Promise<Ledger>>(),
}));

const ROOT = "/repo";
const NOW = "2026-11-16T10:00:00.000Z";
const result = (stdout: string, code = 0, stderr = "") =>
  Promise.resolve({ stdout, stderr, code });

let run: ReturnType<typeof vi.fn<Runner["run"]>>;
let record: ReturnType<typeof vi.fn<Ledger["record"]>>;
let list: ReturnType<typeof vi.fn<Ledger["list"]>>;
let context: CommandContext;

beforeEach(() => {
  vi.resetAllMocks();
  run = vi.fn<Runner["run"]>();
  record = vi.fn<Ledger["record"]>();
  list = vi.fn<Ledger["list"]>();
  list.mockResolvedValue({ events: [], skipped: 0 });
  record.mockResolvedValue({ ok: true } as Awaited<
    ReturnType<Ledger["record"]>
  >);
  vi.mocked(openJudgeLedger).mockResolvedValue({
    record,
    list,
  } as unknown as Ledger);
  context = {
    deps: {
      root: () => Promise.resolve(ROOT),
      runner: { run },
      clock: { now: () => new Date(NOW) },
    },
  } as unknown as CommandContext;
});

describe("the resample ports start a Sonnet reader on the override tier (#852)", () => {
  it("spawns a reader on the re-review tier, with its override reason, and no wait", async () => {
    run.mockReturnValue(result(""));
    const io = await sessionResampleIo(context);

    await io.ports.spawn({
      name: "resample-pr42-aaaaaaaa",
      role: "reader",
      brief: "BRIEF",
      model: "claude-sonnet-5-5",
      effort: "high",
      reason: "re-review of a passed review sample (#852)",
    });

    expect(run).toHaveBeenCalledExactlyOnceWith(
      "node",
      [
        "skills/bin/harness.mjs",
        "session",
        "spawn",
        "--role",
        "reader",
        "--name",
        "resample-pr42-aaaaaaaa",
        "--brief",
        "BRIEF",
        "--model",
        "claude-sonnet-5-5",
        "--effort",
        "high",
        "--reason",
        "re-review of a passed review sample (#852)",
        "--no-wait",
      ],
      { cwd: ROOT },
    );
  });

  it("names the failed spawn and the fix", async () => {
    run.mockReturnValue(result("", 1, "no herdr"));
    const io = await sessionResampleIo(context);

    await expect(
      io.ports.spawn({
        name: "resample-pr42-aaaaaaaa",
        role: "reader",
        brief: "B",
        model: "m",
        effort: "high",
        reason: "r",
      }),
    ).rejects.toThrow(/session spawn.*failed: no herdr/s);
  });
});

describe("the resample ports wait for, read and close the reader's pane (#852)", () => {
  it("waits through session wait and returns the outcome, with no pane", async () => {
    run.mockReturnValue(
      result(JSON.stringify({ name: "n", paneId: "p1", outcome: "blocked" })),
    );
    const io = await sessionResampleIo(context);

    expect(await io.ports.wait("resample-pr42-aaaaaaaa")).toEqual({
      outcome: "blocked",
    });
    expect(run.mock.calls[0]?.[1]).toEqual([
      "skills/bin/harness.mjs",
      "session",
      "wait",
      "resample-pr42-aaaaaaaa",
      "--json",
    ]);
  });

  it("reads the unwrapped text of the pane its session settled in, by session name, and refuses an unsettled session", async () => {
    run
      .mockReturnValueOnce(
        result(JSON.stringify({ name: "n", paneId: "p1", outcome: "done" })),
      )
      .mockReturnValueOnce(result("TEXT"));
    const io = await sessionResampleIo(context);
    await expect(io.ports.read("resample-pr42-aaaaaaaa")).rejects.toThrow(
      /has not settled/,
    );
    await io.ports.wait("resample-pr42-aaaaaaaa");

    expect(await io.ports.read("resample-pr42-aaaaaaaa")).toBe("TEXT");
    expect(run).toHaveBeenLastCalledWith(
      "herdr",
      ["pane", "read", "p1", "--source", "recent-unwrapped"],
      { cwd: ROOT },
    );
  });

  it("closes the reader's session through session close", async () => {
    run.mockReturnValue(result(""));
    const io = await sessionResampleIo(context);

    await io.ports.close("resample-pr42-aaaaaaaa");

    expect(run).toHaveBeenCalledWith(
      "node",
      ["skills/bin/harness.mjs", "session", "close", "resample-pr42-aaaaaaaa"],
      { cwd: ROOT },
    );
  });
});

describe("the resample ports record and read the ledger (#852)", () => {
  it("records a re-review as a review.run with its label and findings", async () => {
    const io = await sessionResampleIo(context);

    await io.ports.record(42, "resample:aaaaaaaa", 2);

    expect(record).toHaveBeenCalledWith({
      source: "claude",
      kind: "review.run",
      occurredAt: NOW,
      number: 42,
      label: "resample:aaaaaaaa",
      stage: "review",
      findings: 2,
    });
  });

  it("records a failed re-review without findings, so no count is read from it", async () => {
    const io = await sessionResampleIo(context);

    await io.ports.record(42, "resample-failed:aaaaaaaa");

    const [event] = record.mock.calls[0] as [Record<string, unknown>];
    expect(event).not.toHaveProperty("findings");
  });

  it("offers the sample every event in the shared ledger, so the pool is read from the whole history", async () => {
    const events = [{ kind: "pr.merged", number: 42 }] as LedgerEvent[];
    list.mockResolvedValue({ events, skipped: 0 });

    const io = await sessionResampleIo(context);

    expect(list).toHaveBeenCalledWith({});
    expect(io.events).toBe(events);
  });
});
