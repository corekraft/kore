import { describe, expect, it, vi, type Mock } from "vitest";
import { precheck, summary } from "../judge/index.js";
import {
  failed,
  prNumber,
  record,
  repoOf,
  reviewersOf,
} from "./judge-shared.js";
import { approveCommands } from "./judge-approve-command.js";
import {
  contextOf,
  OK,
  REPO,
  reportOf,
  ROOT,
} from "./judge-command-support.js";

vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  precheck: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("./judge-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./judge-shared.js")>()),
  failed: vi.fn(),
  prNumber: vi.fn(),
  record: vi.fn(),
  repoOf: vi.fn(),
  reviewersOf: vi.fn(),
}));

interface Review {
  author: { login: string };
  state: string;
  commit: { oid: string };
}

/** The PR as `gh pr view --json author,headRefOid,reviews` prints it. */
const viewJson = (
  over: { author?: string; head?: string; reviews?: Review[] } = {},
): string =>
  JSON.stringify({
    author: { login: over.author ?? "app/kore-writer" },
    headRefOid: over.head ?? "abc1234",
    reviews: over.reviews ?? [],
  });

type Answer = (
  cmd: string,
  args: string[],
  options: { cwd: string },
) => Promise<typeof OK>;

/** A context whose gh answers `gh api user` with the caller and `gh pr view` with the PR. */
function setup(view = viewJson(), caller = "kore-judge", json = false) {
  const { run: untyped, ...made } = contextOf("42", {}, json);
  // The one cast: the shared fixture's runner mock is untyped, and this types it for the whole spec.
  const run = untyped as Mock<Answer>;
  const answer: Answer = (_cmd, args) => {
    if (args[0] === "api") {
      return Promise.resolve({ ...OK, stdout: `${caller}\n` });
    }
    if (args[0] === "pr" && args[1] === "view") {
      return Promise.resolve({ ...OK, stdout: view });
    }
    return Promise.resolve(OK);
  };
  run.mockImplementation(answer);
  vi.mocked(failed).mockReturnValue(1);
  vi.mocked(prNumber).mockReturnValue(42);
  vi.mocked(repoOf).mockResolvedValue(REPO);
  vi.mocked(reviewersOf).mockResolvedValue(["bot"]);
  vi.mocked(precheck).mockResolvedValue(reportOf());
  return { ...made, run, answer };
}

const reviewCalls = (run: ReturnType<typeof setup>["run"]) =>
  run.mock.calls.filter((c) => c[1][1] === "review");

describe("harness judge approve", () => {
  it("approves the head the precheck verified with the pane's own gh identity", async () => {
    const { context, run, stdout } = setup();

    expect(await approveCommands.approve?.run(context)).toBe(0);
    expect(precheck).toHaveBeenCalledWith(context, ROOT, REPO, 42, ["bot"]);
    expect(record).toHaveBeenCalledWith(context, reportOf());
    expect(reviewCalls(run)).toEqual([
      [
        "gh",
        ["pr", "review", "42", "--repo", REPO, "--approve"],
        { cwd: ROOT },
      ],
    ]);
    expect(stdout).toHaveBeenCalledWith("PR #42: approved at abc1234\n");
  });

  it("prints the approval as JSON under --json", async () => {
    const { context, stdout } = setup(viewJson(), "kore-judge", true);

    await approveCommands.approve?.run(context);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ pr: 42, approved: true, head: "abc1234", already: false })}\n`,
    );
  });

  it("approves nothing when the precheck does not pass, and says so on stderr", async () => {
    const { context, run, stdout, stderr } = setup();
    vi.mocked(precheck).mockResolvedValue(reportOf({ ok: false }));
    vi.mocked(summary).mockReturnValue("SUMMARY");

    expect(await approveCommands.approve?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith("SUMMARY");
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "PR #42 was not approved: the precheck did not pass.",
      ),
    );
  });

  it("approves nothing when the precheck reports no head commit", async () => {
    const { context, run } = setup();
    vi.mocked(precheck).mockResolvedValue(reportOf({ head: "" }));

    expect(await approveCommands.approve?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("harness judge approve refusals", () => {
  it("refuses a head that moved after the precheck verified it", async () => {
    const { context, run } = setup(viewJson({ head: "moved99" }));

    expect(await approveCommands.approve?.run(context)).toBe(1);
    expect(reviewCalls(run)).toEqual([]);
    expect(failed).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        message: expect.stringContaining("moved from abc1234 to moved99"),
      }),
    );
  });

  it("refuses to approve a PR its own caller authored", async () => {
    const { context, run } = setup(viewJson({ author: "kore-judge" }));

    expect(await approveCommands.approve?.run(context)).toBe(1);
    expect(reviewCalls(run)).toEqual([]);
    expect(failed).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        message: expect.stringContaining("authored by kore-judge"),
      }),
    );
  });
});

describe("harness judge approve idempotence and failures", () => {
  it("posts nothing again when the caller already approved this head", async () => {
    const approved: Review = {
      author: { login: "kore-judge" },
      state: "APPROVED",
      commit: { oid: "abc1234" },
    };
    const { context, run, stdout } = setup(viewJson({ reviews: [approved] }));

    expect(await approveCommands.approve?.run(context)).toBe(0);
    expect(reviewCalls(run)).toEqual([]);
    expect(stdout).toHaveBeenCalledWith(
      "PR #42: already approved at abc1234\n",
    );
  });

  it.each([
    ["an approval at an older head", "APPROVED", "old0001", "kore-judge"],
    ["another login's approval", "APPROVED", "abc1234", "someone"],
    [
      "a changes-requested review",
      "CHANGES_REQUESTED",
      "abc1234",
      "kore-judge",
    ],
  ])(
    "still approves when the only review is %s",
    async (_name, state, oid, who) => {
      const review: Review = {
        author: { login: who },
        state,
        commit: { oid },
      };
      const { context, run } = setup(viewJson({ reviews: [review] }));

      expect(await approveCommands.approve?.run(context)).toBe(0);
      expect(reviewCalls(run)).toHaveLength(1);
    },
  );
});

describe("harness judge approve gh failures", () => {
  it("fails and names the cause when gh refuses the review", async () => {
    const { context, run, answer } = setup();
    run.mockImplementation((cmd, args, options) =>
      args[1] === "review"
        ? Promise.resolve({ code: 1, stdout: "", stderr: "denied\n" })
        : answer(cmd, args, options),
    );

    expect(await approveCommands.approve?.run(context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        message: expect.stringContaining(
          "gh pr review failed for PR #42: denied",
        ),
      }),
    );
  });

  it("names the missing login, not self-approval, when gh reports an empty caller", async () => {
    const { context, run } = setup(viewJson(), "");

    expect(await approveCommands.approve?.run(context)).toBe(1);
    expect(reviewCalls(run)).toEqual([]);
    expect(failed).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        message: expect.stringContaining(
          "gh could not report the login this pane runs as. Run `gh auth status`",
        ),
      }),
    );
  });

  it("approves nothing when gh cannot say who the caller is", async () => {
    const { context, run, answer } = setup();
    run.mockImplementation((cmd, args, options) =>
      args[0] === "api"
        ? Promise.resolve({ code: 1, stdout: "", stderr: "no auth\n" })
        : answer(cmd, args, options),
    );

    expect(await approveCommands.approve?.run(context)).toBe(1);
    expect(reviewCalls(run)).toEqual([]);
  });

  it("approves nothing on unreadable PR output", async () => {
    const { context, run } = setup("not json");

    expect(await approveCommands.approve?.run(context)).toBe(1);
    expect(reviewCalls(run)).toEqual([]);
  });
});
