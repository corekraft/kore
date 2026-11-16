import { describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { hasSentBack, readPr, sendBackBody } from "../judge/index.js";
import { failed, openJudgeLedger, prNumber, repoOf } from "./judge-shared.js";
import { fakeLedger } from "./command-support.js";
import { mergeCommands } from "./judge-merge-commands.js";
import { contextOf, prView, REPO, ROOT } from "./judge-command-support.js";

vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  hasSentBack: vi.fn(),
  readPr: vi.fn(),
  sendBackBody: vi.fn(),
}));
vi.mock("./judge-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./judge-shared.js")>()),
  failed: vi.fn(),
  openJudgeLedger: vi.fn(),
  prNumber: vi.fn(),
  repoOf: vi.fn(),
}));

const CATEGORIES =
  "declaration, pattern-mismatch, failed-check, conflict, missing-proof, rule-break, scope, other";
const USAGE =
  'Run `harness judge send-back <pr> --reason "<why>" --category <category>`.';

function prepare(
  options: Record<string, string> = {
    reason: "too slow",
    category: "failed-check",
  },
  listed: Partial<LedgerEvent>[] = [],
) {
  const { context, run, stdout } = contextOf("42", options);
  const ledger = fakeLedger(listed);
  vi.mocked(prNumber).mockReturnValue(42);
  vi.mocked(repoOf).mockResolvedValue(REPO);
  vi.mocked(openJudgeLedger).mockResolvedValue(ledger.ledger);
  vi.mocked(readPr).mockResolvedValue(prView({ headSha: "abcdef1234" }));
  vi.mocked(sendBackBody).mockReturnValue("BODY");
  return { context, run, stdout, write: ledger.write };
}

describe("harness judge send-back", () => {
  it("posts the reason on the PR and records a send-back event named by its head", async () => {
    const { context, run, stdout, write } = prepare();
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
    expect(write.mock.calls).toEqual([
      [
        {
          source: "github",
          kind: "send-back",
          occurredAt: "2026-01-02T03:04:05.000Z",
          number: 42,
          label: "too slow @abcdef1",
          category: "failed-check",
        },
      ],
    ]);
    expect(stdout).toHaveBeenCalledWith(
      "PR #42: sent back with the reason on the queue\n",
    );
  });

  it("records the category it was given, and posts the reason only on the PR", async () => {
    const { context, run, write } = prepare({
      reason: "no declaration",
      category: "declaration",
    });
    vi.mocked(hasSentBack).mockReturnValue(false);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(write.mock.calls).toEqual([
      [
        {
          source: "github",
          kind: "send-back",
          occurredAt: "2026-01-02T03:04:05.000Z",
          number: 42,
          label: "no declaration @abcdef1",
          category: "declaration",
        },
      ],
    ]);
  });

  it("does not post the same reason twice, but still records it once", async () => {
    const { context, run, write } = prepare();
    vi.mocked(hasSentBack).mockReturnValue(true);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("harness judge send-back: recording", () => {
  it("records nothing when the newest send-back already carries this label and category", async () => {
    const { context, run, write } = prepare(
      { reason: "too slow", category: "failed-check" },
      [{ number: 42, label: "too slow @abcdef1", category: "failed-check" }],
    );
    vi.mocked(hasSentBack).mockReturnValue(true);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("records a send-back when only the category differs from the newest on the same head", async () => {
    const { context, write } = prepare(
      { reason: "too slow", category: "rule-break" },
      [{ number: 42, label: "too slow @abcdef1", category: "failed-check" }],
    );
    vi.mocked(hasSentBack).mockReturnValue(true);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      label: "too slow @abcdef1",
      category: "rule-break",
    });
  });

  it("truncates a long reason to 100 characters, keeping the head suffix, and flattens control characters", async () => {
    const { context } = contextOf("42", {
      reason: `a\tb\n${"x".repeat(200)}`,
      category: "other",
    });
    const ledger = fakeLedger();
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(openJudgeLedger).mockResolvedValue(ledger.ledger);
    vi.mocked(readPr).mockResolvedValue(prView({ headSha: "abcdef1234" }));
    vi.mocked(hasSentBack).mockReturnValue(true);

    await mergeCommands["send-back"]?.run(context);
    const label = ledger.write.mock.calls[0]?.[0].label ?? "";
    expect(label.length).toBe(100);
    expect(label.startsWith("a b x")).toBe(true);
    expect(label.endsWith("… @abcdef1")).toBe(true);
  });
});

describe("harness judge send-back: refusals", () => {
  it("refuses a send-back with no category, names the list, and touches nothing", async () => {
    const { context, run } = contextOf("42", { reason: "why" });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(readPr).not.toHaveBeenCalled();
    expect(openJudgeLedger).not.toHaveBeenCalled();
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect((error as Error).message).toBe(
      `A send-back needs a --category. Use one of: ${CATEGORIES}. ${USAGE}`,
    );
  });

  it("refuses a category that is not on the list, names the list, and touches nothing", async () => {
    const { context, run } = contextOf("42", {
      reason: "why",
      category: "misc",
    });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(readPr).not.toHaveBeenCalled();
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect((error as Error).message).toBe(
      `"misc" is not a send-back category. Use one of: ${CATEGORIES}. ${USAGE}`,
    );
  });

  it("refuses a send-back without a reason, and posts nothing", async () => {
    const { context, run } = contextOf("42", {
      reason: "   ",
      category: "other",
    });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect((error as Error).message).toContain("A send-back needs a reason.");
  });
});

describe("harness judge send-back: failures", () => {
  it("names the comment failure and the check to run before a rerun", async () => {
    const { context, run } = contextOf("42", {
      reason: "why",
      category: "other",
    });
    run.mockResolvedValue({ code: 1, stdout: "", stderr: "denied" });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(repoOf).mockResolvedValue(REPO);
    vi.mocked(openJudgeLedger).mockResolvedValue(fakeLedger().ledger);
    vi.mocked(readPr).mockResolvedValue(prView({ headSha: "abc" }));
    vi.mocked(hasSentBack).mockReturnValue(false);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(1);
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect((error as Error).message).toBe(
      "gh pr comment failed for PR #42: denied. Check `gh auth status` and the PR number, then rerun `harness judge send-back 42`.",
    );
  });

  it("rejects a send-back ledger event and says the comment is not posted twice", async () => {
    const { context } = contextOf("42", { reason: "why", category: "other" });
    const ledger = fakeLedger([], {
      ok: false,
      field: "label",
      message: "full",
    });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(openJudgeLedger).mockResolvedValue(ledger.ledger);
    vi.mocked(readPr).mockResolvedValue(prView({ headSha: "abc" }));
    vi.mocked(hasSentBack).mockReturnValue(true);
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands["send-back"]?.run(context)).toBe(1);
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect((error as Error).message).toContain(
      "its ledger event was rejected: full Fix the ledger, then rerun `harness judge send-back 42`; the comment is not posted twice.",
    );
  });
});
