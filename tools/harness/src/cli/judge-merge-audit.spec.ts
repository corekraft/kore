import { describe, expect, it, vi } from "vitest";
import { JudgeError, summary } from "../judge/index.js";
import { checkedPrecheck, failed, prNumber, record } from "./judge-shared.js";
import { mergeCommands } from "./judge-merge-commands.js";
import { contextOf, reportOf } from "./judge-command-support.js";

vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  summary: vi.fn(),
}));
vi.mock("./judge-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./judge-shared.js")>()),
  checkedPrecheck: vi.fn(),
  failed: vi.fn(),
  prNumber: vi.fn(),
  record: vi.fn(),
  repoOf: vi.fn(),
  reviewersOf: vi.fn(),
}));

describe("harness judge merge: audit gates", () => {
  const audited = [
    {
      item: "scan" as const,
      rule: "judge-scan",
      mode: "audit" as const,
      result: "fail" as const,
      detail: "2 findings",
    },
  ];

  it("merges when only an audit gate failed, and says what it would have blocked", async () => {
    const { context, run, stdout } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockResolvedValue(reportOf({ audited }));

    expect(await mergeCommands.merge?.run(context)).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(
      "PR #42: squash-merged at abc1234\naudit: scan fail (2 findings); logged, did not block the merge\n",
    );
  });

  it("lists the audited gates in the --json merge result", async () => {
    const { context, stdout } = contextOf("42", {}, true);
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockResolvedValue(reportOf({ audited }));

    await mergeCommands.merge?.run(context);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ pr: 42, merged: true, head: "abc1234", audited })}\n`,
    );
  });

  it("records the audit firing once, before the merge, through the ledger owner", async () => {
    const { context } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    const report = reportOf({ audited });
    vi.mocked(checkedPrecheck).mockResolvedValue(report);

    await mergeCommands.merge?.run(context);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(context, report);
  });

  it("merges nothing and records nothing when a gate mode is refused, never defaulting to enforce or audit", async () => {
    const { context, run } = contextOf("42");
    const refusal = new JudgeError('judge-scan has the mode "warn". Fix it.');
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockRejectedValue(refusal);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(context, refusal);
    expect(record).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("merges nothing when an enforce gate failed beside an audit one", async () => {
    const { context, run } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockResolvedValue(
      reportOf({ ok: false, audited }),
    );
    vi.mocked(summary).mockReturnValue("SUMMARY");

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });
});
