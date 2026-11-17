// `harness approve`: flags in, the Approver and its collaborators mocked, output out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApproveError, Approver } from "../approve/index.js";
import { buildReport } from "../flow/index.js";
import { IdeaRepository } from "../idea/index.js";
import { JudgeError } from "../judge/index.js";
import { fakeContext, fakeLedger } from "./command-support.js";
import { openIssueIo } from "./approve-gh.js";
import { approveCommand, issueNumber } from "./approve-commands.js";
import { loadCost } from "./flow-commands.js";
import { openLedger } from "./ledger-commands.js";

vi.mock("../approve/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../approve/index.js")>()),
  Approver: vi.fn(),
  approveFlagOn: vi.fn(),
  trailingOf: vi.fn(),
}));
vi.mock("../flow/index.js");
vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  IdeaRepository: vi.fn(),
}));
vi.mock("./approve-gh.js");
vi.mock("./flow-commands.js");
vi.mock("./ledger-commands.js");

const run = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  const { ledger } = fakeLedger();
  vi.mocked(openLedger).mockResolvedValue({ ledger });
  vi.mocked(loadCost).mockResolvedValue({ cost: {} as never });
  vi.mocked(openIssueIo).mockResolvedValue({} as never);
  vi.mocked(IdeaRepository).mockImplementation(function () {
    return {} as IdeaRepository;
  });
  vi.mocked(Approver).mockImplementation(function () {
    return { run } as unknown as Approver;
  });
  vi.mocked(buildReport).mockReturnValue({} as never);
});

const approved = {
  idea: "0007",
  issue: 215,
  status: "approved",
  reason: "Auto-approved: because.",
  warnings: [],
};

describe("harness approve", () => {
  it("prints the approval as one JSON object with --json", async () => {
    run.mockResolvedValue(approved);
    const { context, out } = fakeContext({
      json: true,
      options: { idea: "7" },
    });

    expect(await approveCommand.run(context)).toBe(0);
    expect(run).toHaveBeenCalledWith("7");
    expect(out()).toBe(`${JSON.stringify(approved)}\n`);
  });

  it.each([
    [
      "approved",
      "Approved idea 0007: ready-for-agent applied to issue #215. Auto-approved: because.\n",
    ],
    [
      "already-approved",
      "Idea 0007 is already approved on issue #215; nothing changed.\n",
    ],
    [
      "left-for-person",
      "Left idea 0007 for a person: Auto-approved: because. (reason posted on issue #215)\n",
    ],
    [
      "flag-off",
      "The automatic-approval flag is off, so nothing was written for idea 0007. Verdict: Auto-approved: because.\n",
    ],
  ])("says what happened when the status is %s", async (status, text) => {
    run.mockResolvedValue({ ...approved, status });
    const { context, out } = fakeContext({ options: { idea: "7" } });

    expect(await approveCommand.run(context)).toBe(0);
    expect(out()).toBe(text);
  });

  it("exits 2 naming the fix when --idea is missing, and approves nothing", async () => {
    const { context, err } = fakeContext();

    expect(await approveCommand.run(context)).toBe(2);
    expect(err()).toBe(
      "Missing --idea; run `harness approve --idea <number or slug>`.\n",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["an ApproveError", new ApproveError("no issue.")],
    ["a JudgeError", new JudgeError("no repo.")],
  ])("exits 1 with the message for %s", async (_n, error) => {
    run.mockRejectedValue(error);
    const { context, err } = fakeContext({
      json: true,
      options: { idea: "7" },
    });

    expect(await approveCommand.run(context)).toBe(1);
    expect(err()).toBe(
      `${JSON.stringify({ error: error.message })}\n${error.message}\n`,
    );
  });

  it("rethrows an unexpected error rather than hiding it", async () => {
    run.mockRejectedValue(new TypeError("bug"));
    const { context } = fakeContext({ options: { idea: "7" } });

    await expect(approveCommand.run(context)).rejects.toThrow("bug");
  });
});

describe("harness approve, the qualifier's warnings", () => {
  it("prints each warning on its own line after the verdict, and still exits 0", async () => {
    run.mockResolvedValue({
      ...approved,
      warnings: ["friction.total is a guard metric.", "Second warning."],
    });
    const { context, out, err } = fakeContext({ options: { idea: "7" } });

    expect(await approveCommand.run(context)).toBe(0);
    expect(out()).toBe(
      "Approved idea 0007: ready-for-agent applied to issue #215. Auto-approved: because.\nWarning: friction.total is a guard metric.\nWarning: Second warning.\n",
    );
    expect(err()).toBe("");
  });

  it("gives the approver every idea in the repository, so it can see the other open ones", async () => {
    const every = [{ number: "0008" }];
    vi.mocked(IdeaRepository).mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue(every),
      } as unknown as IdeaRepository;
    });
    run.mockResolvedValue(approved);
    const { context } = fakeContext({ options: { idea: "7" } });

    await approveCommand.run(context);

    const ports = vi.mocked(Approver).mock.calls[0]?.[0] as unknown as {
      ideas: () => Promise<unknown[]>;
    };
    expect(await ports.ideas()).toEqual(every);
  });
});

describe("issueNumber", () => {
  it.each([
    ["215", 215],
    ["#215", 215],
    ["https://github.com/corekraft/kore/issues/215", 215],
  ])("reads %s as issue %s", (link, number) => {
    expect(issueNumber({ issue: link } as never)).toBe(number);
  });

  it("is undefined for an idea with no issue or an unreadable link", () => {
    expect(issueNumber({} as never)).toBeUndefined();
    expect(issueNumber({ issue: "later" } as never)).toBeUndefined();
  });
});
