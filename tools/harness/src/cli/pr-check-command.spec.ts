import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorCheck, JudgeError, type AuthorCheck } from "../judge/index.js";
import type { Report } from "../judge/index.js";
import type { Ledger } from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";
import {
  checkedPrecheck,
  failed,
  openJudgeLedger,
  repoOf,
  reviewersOf,
} from "./judge-shared.js";
import { prCheckCommand, prCheckRun } from "./pr-check-command.js";

vi.mock("../judge/index.js", () => ({
  JudgeError: class JudgeFault extends Error {},
  authorCheck: vi.fn<(report: unknown) => AuthorCheck>(),
}));
vi.mock("./judge-shared.js", () => ({
  FAILED: 1,
  checkedPrecheck: vi.fn<(...args: unknown[]) => Promise<Report>>(),
  failed: vi.fn<(context: CommandContext, error: unknown) => number>(),
  openJudgeLedger: vi.fn<(context: CommandContext) => Promise<unknown>>(),
  prNumber: (operand: string | undefined) => Number(operand),
  repoOf: vi.fn<(context: CommandContext) => Promise<string>>(),
  reviewersOf:
    vi.fn<(context: CommandContext, repo: string) => Promise<string[]>>(),
}));

const NOW = "2026-11-16T10:00:00.000Z";

const report = (idea: string | undefined): Report => ({
  pr: 12,
  ok: false,
  reviewers: [],
  pattern: undefined,
  idea,
  declaration: { ok: true },
});

interface Setup {
  view: AuthorCheck;
  json?: boolean;
  ledgerOk?: boolean;
  idea?: string;
}

/** Wires the judge run, its classification and the ledger; returns what the command printed and recorded. */
function arrange({ view, json = false, ledgerOk = true, idea }: Setup) {
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const record = vi.fn<(event: unknown) => Promise<unknown>>();
  record.mockResolvedValue(
    ledgerOk ? { ok: true } : { ok: false, message: "label too long" },
  );
  vi.mocked(repoOf).mockResolvedValue("corekraft/kore");
  vi.mocked(reviewersOf).mockResolvedValue(["bot"]);
  vi.mocked(checkedPrecheck).mockResolvedValue(report(idea));
  vi.mocked(authorCheck).mockReturnValue(view);
  vi.mocked(openJudgeLedger).mockResolvedValue({ record } as unknown as Ledger);
  vi.mocked(failed).mockReset();
  vi.mocked(failed).mockReturnValue(1);
  const context = {
    operand: "12",
    options: {},
    json,
    deps: {
      root: () => Promise.resolve("/repo"),
      clock: { now: () => new Date(NOW) },
      stdout,
      stderr,
    },
  } as unknown as CommandContext;
  return { context, stdout, record };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const FAILING = (pending: string[] = []): AuthorCheck => ({
  pr: 12,
  ok: false,
  failures: [
    { category: "failed-check", item: "scan", detail: "scan: failure" },
  ],
  pending,
});

describe("harness pr check exits 0 when only pending items remain, and lists them", () => {
  it("prints that nothing is for the writer to fix, and names the pending CI", async () => {
    const f = arrange({
      view: { pr: 12, ok: true, failures: [], pending: ["ci"] },
    });
    expect(await prCheckRun(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith(
      "PR #12: nothing for you to fix\npending, the judge waits on these: ci\n",
    );
  });

  it("prints ready for the judge when nothing fails and nothing is pending", async () => {
    const f = arrange({
      view: { pr: 12, ok: true, failures: [], pending: [] },
    });
    expect(await prCheckRun(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith("PR #12: ready for the judge\n");
  });
});

describe("harness pr check prints each file-length audit with its file, count and fix, and never fails on it", () => {
  const AUDIT = {
    item: "file-length",
    file: "tools/harness/src/a.spec.ts",
    detail: "301 non-blank, non-comment lines; the limit is 300",
    fix: "split it into smaller modules",
  };

  it("prints the audit beside ready for the judge, and exits 0", async () => {
    const f = arrange({
      view: { pr: 12, ok: true, failures: [], pending: [], audits: [AUDIT] },
    });
    expect(await prCheckRun(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith(
      "PR #12: ready for the judge\naudit: file-length tools/harness/src/a.spec.ts: 301 non-blank, non-comment lines; the limit is 300; fix: split it into smaller modules; reported, not sent back\n",
    );
  });

  it("prints a type-cast audit with its file and line, and exits 0: a cast never fails the check", async () => {
    const f = arrange({
      view: {
        pr: 12,
        ok: true,
        failures: [],
        pending: [],
        audits: [
          {
            item: "type-cast",
            file: "tools/harness/src/a.spec.ts",
            line: 7,
            detail: "as never",
            fix: "replace the cast with a type guard or a corrected declared type",
          },
        ],
      },
    });
    expect(await prCheckRun(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith(
      "PR #12: ready for the judge\naudit: type-cast tools/harness/src/a.spec.ts:7: as never; fix: replace the cast with a type guard or a corrected declared type; reported, not sent back\n",
    );
  });

  it("prints the audit beside a failure the writer owns, and still names the failure", async () => {
    const f = arrange({
      view: { ...FAILING(), audits: [AUDIT] },
    });
    expect(await prCheckRun(f.context)).toBe(1);
    expect(f.stdout).toHaveBeenCalledWith(
      expect.stringContaining(
        "  failed-check: scan (scan: failure)\naudit: file-length tools/harness/src/a.spec.ts: 301 non-blank, non-comment lines; the limit is 300; fix: split it into smaller modules; reported, not sent back\n",
      ),
    );
  });
});

describe("harness pr check exits 1 on a failure the writer owns, and names each one", () => {
  it("names each failure with its category and detail, and says to fix, push and rerun once", async () => {
    const f = arrange({ view: FAILING() });
    expect(await prCheckRun(f.context)).toBe(1);
    expect(f.stdout).toHaveBeenCalledWith(
      "PR #12: fix these, push, then run harness pr check once more\n  failed-check: scan (scan: failure)\n",
    );
  });

  it("lists the pending items beside a failure, for the judge to wait on", async () => {
    const f = arrange({ view: FAILING(["principles-review"]) });
    expect(await prCheckRun(f.context)).toBe(1);
    expect(f.stdout).toHaveBeenCalledWith(
      "PR #12: fix these, push, then run harness pr check once more\n  failed-check: scan (scan: failure)\npending, the judge waits on these: principles-review\n",
    );
  });
});

describe("harness pr check --json prints the classification as one object", () => {
  it("prints the PR, its result, the failures and the pending items", async () => {
    const f = arrange({ view: FAILING(["ci"]), json: true });
    await prCheckRun(f.context);
    expect(f.stdout).toHaveBeenCalledWith(
      '{"pr":12,"ok":false,"failures":[{"category":"failed-check","item":"scan","detail":"scan: failure"}],"pending":["ci"]}\n',
    );
  });
});

describe("harness pr check records one pr.checked event with the failure categories, and no send-back", () => {
  it("records one pr.checked event naming the failure categories it found", async () => {
    const f = arrange({
      view: {
        pr: 12,
        ok: false,
        failures: [
          { category: "declaration", item: "declaration" },
          { category: "failed-check", item: "scan" },
          { category: "failed-check", item: "coverage" },
        ],
        pending: [],
      },
      idea: "0010",
    });
    await prCheckRun(f.context);
    expect(f.record).toHaveBeenCalledTimes(1);
    expect(f.record).toHaveBeenCalledWith({
      source: "github",
      kind: "pr.checked",
      occurredAt: NOW,
      number: 12,
      label: "declaration,failed-check",
      idea: "0010",
    });
  });

  it("records the event as none when nothing the writer owns fails", async () => {
    const f = arrange({
      view: { pr: 12, ok: true, failures: [], pending: ["ci"] },
    });
    await prCheckRun(f.context);
    expect(f.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "pr.checked", label: "none" }),
    );
  });

  it("never records a send-back, whatever it finds", async () => {
    const f = arrange({ view: FAILING() });
    await prCheckRun(f.context);
    expect(f.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "send-back" }),
    );
  });
});

describe("harness pr check records nothing when the judge's report cannot be read", () => {
  it("passes the unreadable PR through the shared failure path, appending no event", async () => {
    const f = arrange({ view: FAILING() });
    const unreadable = new JudgeError("gh pr view failed");
    vi.mocked(checkedPrecheck).mockRejectedValue(unreadable);
    expect(await prCheckRun(f.context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(f.context, unreadable);
    expect(f.record).not.toHaveBeenCalled();
  });

  it("refuses a rejected ledger write through the shared failure path", async () => {
    const f = arrange({ view: FAILING(), ledgerOk: false });
    expect(await prCheckRun(f.context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(
      f.context,
      expect.objectContaining({
        message: expect.stringContaining("label too long") as unknown,
      }),
    );
  });
});

describe("harness pr check is declared as a mutating command on a pr operand", () => {
  it("says it appends one event, takes a pr operand and no options beyond --json", () => {
    expect(prCheckCommand.summary).toMatch(/^mutates;/);
    expect(prCheckCommand.summary).toContain("pr.checked");
    expect(prCheckCommand.operand).toBe("pr");
    expect(prCheckCommand.options ?? {}).toEqual({});
  });
});

it("hands the judge's own report to the classifier, so the writer reads what the judge reads", async () => {
  const f = arrange({ view: FAILING() });
  await prCheckRun(f.context);
  expect(authorCheck).toHaveBeenCalledWith(report(undefined));
  expect(openJudgeLedger).toHaveBeenCalledTimes(1);
});
