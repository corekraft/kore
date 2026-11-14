import { describe, expect, it, vi } from "vitest";
import {
  hasSentBack,
  JudgeError,
  precheck,
  readPr,
  sendBackBody,
  summary,
} from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import {
  failed,
  openJudgeLedger,
  prNumber,
  record,
  repoOf,
  reviewersOf,
} from "./judge-shared.js";
import { mergeCommands } from "./judge-merge-commands.js";

vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  hasSentBack: vi.fn(),
  precheck: vi.fn(),
  readPr: vi.fn(),
  sendBackBody: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("./judge-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./judge-shared.js")>()),
  failed: vi.fn(),
  openJudgeLedger: vi.fn(),
  prNumber: vi.fn(),
  record: vi.fn(),
  repoOf: vi.fn(),
  reviewersOf: vi.fn(),
}));

const ROOT = "/repo";
const REPO = "corekraft/kore";
const CLOCK = { now: () => new Date("2026-01-02T03:04:05Z") };
const OK = { code: 0, stdout: "", stderr: "" };

function contextOf(
  operand: string | undefined,
  options: Record<string, string | boolean> = {},
  json = false,
) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  const run = vi.fn().mockResolvedValue(OK);
  const context = {
    json,
    operand,
    options,
    deps: {
      root: vi.fn().mockResolvedValue(ROOT),
      runner: { run },
      clock: CLOCK,
      stdout,
      stderr,
    },
  } as unknown as CommandContext;
  return { context, run, stdout, stderr };
}

function reportOf(overrides: Record<string, unknown> = {}) {
  return { ok: true, head: "abc1234", pr: 42, ...overrides };
}

describe("harness judge merge", () => {
  it("re-runs the precheck and squash-merges the head it verified", async () => {
    const { context, run, stdout } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(repoOf).mockResolvedValue(REPO);
    vi.mocked(reviewersOf).mockResolvedValue(["bot"]);
    vi.mocked(precheck).mockResolvedValue(reportOf() as never);

    expect(await mergeCommands.merge?.run(context)).toBe(0);
    expect(precheck).toHaveBeenCalledWith(context, ROOT, REPO, 42, ["bot"]);
    expect(run.mock.calls).toEqual([
      [
        "gh",
        [
          "pr",
          "merge",
          "42",
          "--repo",
          REPO,
          "--squash",
          "--match-head-commit",
          "abc1234",
        ],
        { cwd: ROOT },
      ],
    ]);
    expect(stdout).toHaveBeenCalledWith("PR #42: squash-merged at abc1234\n");
  });

  it("records the precheck verdict before it decides whether to merge", async () => {
    const { context } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(precheck).mockResolvedValue(reportOf() as never);

    await mergeCommands.merge?.run(context);
    expect(record).toHaveBeenCalledWith(context, reportOf());
  });

  it("prints the merge as JSON under --json", async () => {
    const { context, stdout } = contextOf("42", {}, true);
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(precheck).mockResolvedValue(reportOf() as never);

    await mergeCommands.merge?.run(context);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ pr: 42, merged: true, head: "abc1234" })}\n`,
    );
  });

  it("merges nothing when the precheck does not pass, and says so on stderr", async () => {
    const { context, run, stdout, stderr } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(precheck).mockResolvedValue(reportOf({ ok: false }) as never);
    vi.mocked(summary).mockReturnValue("SUMMARY");

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith("SUMMARY");
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "PR #42 was not merged: the precheck did not pass.",
      ),
    );
  });

  it("merges nothing when the precheck reports no head commit to match", async () => {
    const { context, run } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(precheck).mockResolvedValue(reportOf({ head: "" }) as never);

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("harness judge merge: refusals", () => {
  it("reports a refused gh merge with the head to verify again", async () => {
    const { context, run } = contextOf("42");
    run.mockResolvedValue({ code: 1, stdout: "", stderr: "head moved\n" });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(precheck).mockResolvedValue(reportOf() as never);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(JudgeError);
    expect((error as Error).message).toBe(
      "gh pr merge failed for PR #42: head moved. If the head moved, rerun `harness judge merge 42` to verify the new commit.",
    );
  });
});

describe("harness judge merge: a missing PR number", () => {
  it("hands a missing PR number to the shared failure reporter, and merges nothing", async () => {
    const { context, run } = contextOf(undefined);
    const usage = new JudgeError("Missing or invalid PR number.");
    vi.mocked(prNumber).mockImplementation(() => {
      throw usage;
    });
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(context, usage);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("harness judge send-back", () => {
  function ledgerOf(
    events: { number?: number; label?: string }[] = [],
    write = vi.fn().mockResolvedValue({ ok: true }),
  ) {
    return {
      list: vi.fn().mockResolvedValue({ events }),
      record: write,
    };
  }

  function prepare(options: Record<string, string> = { reason: "too slow" }) {
    const { context, run, stdout } = contextOf("42", options);
    const ledger = ledgerOf();
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(repoOf).mockResolvedValue(REPO);
    vi.mocked(openJudgeLedger).mockResolvedValue(ledger as never);
    vi.mocked(readPr).mockResolvedValue({ headSha: "abcdef1234" } as never);
    vi.mocked(sendBackBody).mockReturnValue("BODY");
    return { context, run, stdout, ledger };
  }

  it("posts the reason on the PR and records a send-back event named by its head", async () => {
    const { context, run, stdout, ledger } = prepare();
    vi.mocked(hasSentBack).mockReturnValue(false);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(0);
    expect(run.mock.calls).toEqual([
      [
        "gh",
        ["pr", "comment", "42", "--repo", REPO, "--body", "BODY"],
        { cwd: ROOT },
      ],
    ]);
    expect(sendBackBody).toHaveBeenCalledWith("too slow", "abcdef1234");
    expect(ledger.record.mock.calls).toEqual([
      [
        {
          source: "github",
          kind: "send-back",
          occurredAt: "2026-01-02T03:04:05.000Z",
          number: 42,
          label: "too slow @abcdef1",
        },
      ],
    ]);
    expect(stdout).toHaveBeenCalledWith(
      "PR #42: sent back with the reason on the queue\n",
    );
  });

  it("does not post the same reason twice, but still records it once", async () => {
    const { context, run, ledger } = prepare();
    vi.mocked(hasSentBack).mockReturnValue(true);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(ledger.record).toHaveBeenCalledTimes(1);
  });

  it("records nothing when the newest send-back already carries this label", async () => {
    const { context, run, ledger } = prepare();
    ledger.list.mockResolvedValue({
      events: [{ number: 42, label: "too slow @abcdef1" }],
    });
    vi.mocked(hasSentBack).mockReturnValue(true);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });
});

describe("harness judge send-back: reason and failures", () => {
  it("names the comment failure and the check to run before a rerun", async () => {
    const { context, run } = contextOf("42", { reason: "why" });
    run.mockResolvedValue({ code: 1, stdout: "", stderr: "denied" });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(repoOf).mockResolvedValue(REPO);
    vi.mocked(openJudgeLedger).mockResolvedValue({
      list: vi.fn().mockResolvedValue({ events: [] }),
      record: vi.fn(),
    } as never);
    vi.mocked(readPr).mockResolvedValue({ headSha: "abc" } as never);
    vi.mocked(hasSentBack).mockReturnValue(false);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(1);
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect((error as Error).message).toBe(
      "gh pr comment failed for PR #42: denied. Check `gh auth status` and the PR number, then rerun `harness judge send-back 42`.",
    );
  });

  it("refuses a send-back without a reason, and posts nothing", async () => {
    const { context, run } = contextOf("42", { reason: "   " });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect((error as Error).message).toContain("A send-back needs a reason.");
  });

  it("truncates a long reason to 100 characters, keeping the head suffix, and flattens control characters", async () => {
    const { context } = contextOf("42", { reason: `a\tb\n${"x".repeat(200)}` });
    const ledger = {
      list: vi.fn().mockResolvedValue({ events: [] }),
      record: vi.fn().mockResolvedValue({ ok: true }),
    };
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(openJudgeLedger).mockResolvedValue(ledger as never);
    vi.mocked(readPr).mockResolvedValue({ headSha: "abcdef1234" } as never);
    vi.mocked(hasSentBack).mockReturnValue(true);

    await mergeCommands["send-back"]?.run(context);
    const label = ledger.record.mock.calls[0]?.[0].label as string;
    expect(label.length).toBe(100);
    expect(label.startsWith("a b x")).toBe(true);
    expect(label.endsWith("… @abcdef1")).toBe(true);
  });

  it("rejects a send-back ledger event and says the comment is not posted twice", async () => {
    const { context } = contextOf("42", { reason: "why" });
    const ledger = {
      list: vi.fn().mockResolvedValue({ events: [] }),
      record: vi.fn().mockResolvedValue({ ok: false, message: "full" }),
    };
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(openJudgeLedger).mockResolvedValue(ledger as never);
    vi.mocked(readPr).mockResolvedValue({ headSha: "abc" } as never);
    vi.mocked(hasSentBack).mockReturnValue(true);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(1);
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect((error as Error).message).toContain(
      "its ledger event was rejected: full Fix the ledger, then rerun `harness judge send-back 42`; the comment is not posted twice.",
    );
  });
});
