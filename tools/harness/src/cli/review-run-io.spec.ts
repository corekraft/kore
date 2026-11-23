import { beforeEach, describe, expect, it, vi } from "vitest";
import { JudgeError, type PrView } from "../judge/index.js";
import type { Ledger } from "../ledger/index.js";
import type { CommandContext, Runner } from "../runtime/index.js";
import { openJudgeLedger } from "./judge-shared.js";
import { ghReviewIo, type ReviewIo } from "./review-gh.js";
import { sessionReviewPorts } from "./review-run-io.js";

vi.mock("../judge/index.js", () => {
  class ErrorStandIn extends Error {}
  return { JudgeError: ErrorStandIn };
});
vi.mock("./review-gh.js", () => ({
  ghReviewIo: vi.fn<(context: CommandContext) => Promise<ReviewIo>>(),
}));
vi.mock("./judge-shared.js", () => ({
  openJudgeLedger: vi.fn<(context: CommandContext) => Promise<Ledger>>(),
}));

const ROOT = "/repo";
const NOW = "2026-11-15T10:00:00.000Z";
const result = (stdout: string, code = 0, stderr = "") =>
  Promise.resolve({ stdout, stderr, code });

let run: ReturnType<typeof vi.fn<Runner["run"]>>;
let record: ReturnType<typeof vi.fn<Ledger["record"]>>;
let io: { view: ReturnType<typeof vi.fn>; comment: ReturnType<typeof vi.fn> };
let context: CommandContext;

beforeEach(() => {
  vi.resetAllMocks();
  run = vi.fn<Runner["run"]>();
  record = vi.fn<Ledger["record"]>();
  io = { view: vi.fn(), comment: vi.fn() };
  vi.mocked(ghReviewIo).mockResolvedValue(io as unknown as ReviewIo);
  vi.mocked(openJudgeLedger).mockResolvedValue({ record } as unknown as Ledger);
  context = {
    deps: {
      root: () => Promise.resolve(ROOT),
      runner: { run },
      clock: { now: () => new Date(NOW) },
    },
  } as unknown as CommandContext;
});

describe("the review run ports start and read the Reviewer through the session tools", () => {
  it("reads and comments the PR through the review port", async () => {
    io.view.mockResolvedValue({ headSha: "h" } as PrView);
    io.comment.mockResolvedValue("URL");
    const ports = await sessionReviewPorts(context);
    expect((await ports.view(42)).headSha).toBe("h");
    expect(await ports.comment(42, "B")).toBe("URL");
    expect(io.view).toHaveBeenCalledWith(42);
    expect(io.comment).toHaveBeenCalledWith(42, "B");
  });

  it("spawns the principles-review role with its own tier and no wait, with no model flag", async () => {
    run.mockReturnValue(result(""));
    await (await sessionReviewPorts(context)).spawn("pr42-reviewer", "BRIEF");
    expect(run).toHaveBeenCalledExactlyOnceWith(
      "node",
      [
        "skills/bin/harness.mjs",
        "session",
        "spawn",
        "--role",
        "principles-review",
        "--name",
        "pr42-reviewer",
        "--brief",
        "BRIEF",
        "--no-wait",
      ],
      { cwd: ROOT },
    );
  });

  it("names the failed spawn and the fix", async () => {
    run.mockReturnValue(result("", 1, "no session"));
    await expect(
      (await sessionReviewPorts(context)).spawn("pr42-reviewer", "B"),
    ).rejects.toThrow(/session spawn.*failed: no session/s);
  });

  it("waits through session wait and returns the outcome, with no pane", async () => {
    run.mockReturnValue(
      result(
        JSON.stringify({
          name: "n",
          paneId: "p1",
          outcome: "done",
          model: "m",
        }),
      ),
    );
    expect(
      await (await sessionReviewPorts(context)).wait("pr42-reviewer"),
    ).toEqual({ outcome: "done" });
    expect(run.mock.calls[0]?.[1]).toEqual([
      "skills/bin/harness.mjs",
      "session",
      "wait",
      "pr42-reviewer",
      "--json",
    ]);
  });
});

describe("the review run ports read a Reviewer's text only after its wait, and close it", () => {
  it("refuses to read a Reviewer's session it has not waited for", async () => {
    const ports = await sessionReviewPorts(context);

    await expect(ports.read("pr42-reviewer")).rejects.toThrow(
      /has not settled, so its text is not read/,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("closes the session through session close", async () => {
    run.mockReturnValue(result(""));
    await (await sessionReviewPorts(context)).close("pr42-reviewer");
    expect(run.mock.calls[0]?.[1]).toEqual([
      "skills/bin/harness.mjs",
      "session",
      "close",
      "pr42-reviewer",
    ]);
  });
});

describe("the review run port records its events in the ledger", () => {
  it("records a review.run event for the PR in the review stage", async () => {
    record.mockResolvedValue({ ok: true } as never);
    await (await sessionReviewPorts(context)).record(42, "posted:abc1234d");
    expect(record).toHaveBeenCalledExactlyOnceWith({
      source: "claude",
      kind: "review.run",
      occurredAt: NOW,
      number: 42,
      label: "posted:abc1234d",
      stage: "review",
    });
  });

  it("records the findings count on the event when the verdict gave one", async () => {
    record.mockResolvedValue({ ok: true } as never);
    await (await sessionReviewPorts(context)).record(42, "posted:abc1234d", 2);
    expect(record).toHaveBeenCalledExactlyOnceWith({
      source: "claude",
      kind: "review.run",
      occurredAt: NOW,
      number: 42,
      label: "posted:abc1234d",
      stage: "review",
      findings: 2,
    });
  });

  it("refuses a rejected ledger event with the reason", async () => {
    record.mockResolvedValue({ ok: false, message: "bad label" } as never);
    await expect(
      (await sessionReviewPorts(context)).record(42, "x"),
    ).rejects.toThrow(JudgeError);
  });
});

describe("the review run ports read an hc Reviewer's verdict from its wait, never a pane", () => {
  it("returns the summary its wait printed, and runs no pane read through herdr", async () => {
    run.mockReturnValueOnce(
      result(
        JSON.stringify({
          name: "pr42-reviewer",
          model: "m",
          outcome: "done",
          summary: "VERDICT: none",
          seq: 1,
        }),
      ),
    );
    const ports = await sessionReviewPorts(context);
    await ports.wait("pr42-reviewer");

    expect(await ports.read("pr42-reviewer")).toBe("VERDICT: none");
    expect(run).toHaveBeenCalledExactlyOnceWith(
      "node",
      ["skills/bin/harness.mjs", "session", "wait", "pr42-reviewer", "--json"],
      { cwd: ROOT },
    );
  });
});
