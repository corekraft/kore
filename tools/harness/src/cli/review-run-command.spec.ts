import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_REVIEW_RUNS,
  ReviewRun,
  type ReviewPorts,
  type ReviewRunResult,
} from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { senderFrom, type Sender } from "../sender/index.js";
import { briefBackend } from "../session/index.js";
import { failed, prNumber } from "./judge-shared.js";
import { reviewRunRun } from "./review-run-command.js";
import { sessionReviewPorts } from "./review-run-io.js";

vi.mock("../judge/index.js", async (original) => ({
  ...(await original<typeof import("../judge/index.js")>()),
  ReviewRun: vi.fn<(ports: ReviewPorts) => unknown>(),
}));
vi.mock("../sender/index.js", () => ({
  senderFrom:
    vi.fn<
      (
        env: Readonly<Record<string, string | undefined>>,
        command: string,
      ) => Sender | { error: string }
    >(),
}));
vi.mock("./judge-shared.js", () => ({
  prNumber: vi.fn<(operand: string | undefined, usage: string) => number>(),
  failed: vi.fn<(context: CommandContext, error: unknown) => number>(),
}));
vi.mock("../session/index.js", () => ({
  briefBackend: vi.fn<(deps: unknown) => Promise<"herdr" | "hc">>(),
}));
vi.mock("./review-run-io.js", () => ({
  sessionReviewPorts:
    vi.fn<(context: CommandContext) => Promise<ReviewPorts>>(),
}));

const done = (over: Partial<ReviewRunResult> = {}): ReviewRunResult => ({
  pr: 42,
  head: "abc1234d",
  posted: true,
  runs: 1,
  ...over,
});

const SENDER: Sender = { command: "review run" };
const ENV = { KORE_ROLE: "writer", KORE_AGENT: "fix-x" };
let stdout: ReturnType<typeof vi.fn<(text: string) => void>>;
let run: ReturnType<
  typeof vi.fn<(pr: number, sender: Sender) => Promise<ReviewRunResult>>
>;
const contextOf = (json = false): CommandContext =>
  ({
    operand: "42",
    json,
    options: {},
    deps: { stdout, env: ENV },
  }) as unknown as CommandContext;

beforeEach(() => {
  vi.resetAllMocks();
  stdout = vi.fn<(text: string) => void>();
  run = vi.fn<(pr: number, sender: Sender) => Promise<ReviewRunResult>>();
  vi.mocked(senderFrom).mockReturnValue(SENDER);
  vi.mocked(prNumber).mockReturnValue(42);
  vi.mocked(sessionReviewPorts).mockResolvedValue({} as ReviewPorts);
  vi.mocked(briefBackend).mockResolvedValue("herdr");
  vi.mocked(ReviewRun).mockImplementation(function () {
    return { run };
  } as never);
});

describe("review run reviews the PR and prints what it posted", () => {
  it("builds the run on the real ports and reviews the named PR", async () => {
    run.mockResolvedValue(done());
    expect(await reviewRunRun(contextOf())).toBe(0);
    expect(run).toHaveBeenCalledExactlyOnceWith(42, SENDER);
    expect(stdout).toHaveBeenCalledWith(
      "PR #42: principles-review verdict posted for head abc1234d\n",
    );
  });

  it("says nothing was posted when the identical verdict was already on the head", async () => {
    run.mockResolvedValue(done({ posted: false }));
    await reviewRunRun(contextOf());
    expect(stdout).toHaveBeenCalledWith(
      "PR #42: the verdict for head abc1234d was already posted; nothing posted\n",
    );
  });

  it("mentions the extra reviews a moved head cost", async () => {
    run.mockResolvedValue(done({ runs: 2 }));
    await reviewRunRun(contextOf());
    expect(stdout.mock.calls[0]?.[0]).toContain("after 2 reviews");
  });

  it("prints the result as one JSON object with --json", async () => {
    run.mockResolvedValue(done());
    await reviewRunRun(contextOf(true));
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(done())}\n`);
  });

  it("reports a failed review through the shared failure path and exits with its code", async () => {
    const error = new Error("no verdict");
    run.mockRejectedValue(error);
    vi.mocked(failed).mockReturnValue(1);
    expect(await reviewRunRun(contextOf())).toBe(1);
    expect(failed).toHaveBeenCalledWith(expect.anything(), error);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("names the sender from the caller's environment as review run", async () => {
    run.mockResolvedValue(done());
    await reviewRunRun(contextOf());
    expect(senderFrom).toHaveBeenCalledExactlyOnceWith(ENV, "review run");
  });

  it("refuses a sender the environment cannot name before it starts any pane", async () => {
    const refusal = "KORE_ROLE is set but KORE_AGENT is not.";
    vi.mocked(senderFrom).mockReturnValue({ error: refusal });
    vi.mocked(failed).mockReturnValue(1);
    expect(await reviewRunRun(contextOf())).toBe(1);
    expect(failed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: refusal }),
    );
    expect(sessionReviewPorts).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("reaches no port when the PR number is refused", async () => {
    const error = new Error("bad pr");
    vi.mocked(prNumber).mockImplementation(() => {
      throw error;
    });
    vi.mocked(failed).mockReturnValue(1);
    expect(await reviewRunRun(contextOf())).toBe(1);
    expect(sessionReviewPorts).not.toHaveBeenCalled();
  });
});

describe("review run takes the brief backend the hc-sessions flag names", () => {
  it("builds the ports and the run for hc when the flag is on, with the same review cap", async () => {
    vi.mocked(briefBackend).mockResolvedValue("hc");
    run.mockResolvedValue(done());
    const context = contextOf();

    await reviewRunRun(context);

    expect(sessionReviewPorts).toHaveBeenCalledExactlyOnceWith(context, "hc");
    expect(ReviewRun).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      MAX_REVIEW_RUNS,
      "hc",
    );
  });
});
