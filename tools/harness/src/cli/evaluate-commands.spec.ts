import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateIdea } from "../evaluate/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { evaluateCommand } from "./evaluate-commands.js";
import { openLedger } from "./ledger-commands.js";
import { logOutcome } from "./outcome-commands.js";

vi.mock("../evaluate/index.js");
vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  IdeaRepository: vi.fn(),
}));
vi.mock("./ledger-commands.js");
vi.mock("./outcome-commands.js");

const ROOT = "a-root";
const EVENTS = [{ kind: "pr.merged" }] as LedgerEvent[];
const NOW = new Date("2026-11-14T08:30:00Z");
const ISSUE = "https://github.com/corekraft/kore/issues/300";

function run(options: Record<string, string | boolean>, json = false) {
  const deps = {
    root: vi.fn(() => Promise.resolve(ROOT)),
    runner: { run: vi.fn() },
    clock: { now: vi.fn(() => NOW), sleep: vi.fn() },
    fs: {},
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
  };
  return {
    deps,
    result: evaluateCommand.run(contextWith(deps, options, json)),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  const ledger = fakeLedger(EVENTS);
  vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
  vi.mocked(evaluateIdea).mockResolvedValue({
    status: "recorded",
    idea: "0007",
    result: "refuted",
    before: 100,
    after: 130,
    concluded: {
      idea: "0007",
      result: "refuted",
      issue: ISSUE,
      followUp: "docs/ideas/0008-follow-up.md",
      published: { commented: true, labelled: true, closed: true },
    },
  });
});

describe("harness evaluate", () => {
  it("evaluates the idea against the ledger's events and logs the outcome event", async () => {
    const { deps, result } = run({ idea: "7" });
    expect(await result).toBe(0);
    expect(IdeaRepository).toHaveBeenCalledWith(deps.fs, deps.clock, ROOT);
    expect(evaluateIdea).toHaveBeenCalledWith(
      expect.objectContaining({ runner: deps.runner, root: ROOT }),
      EVENTS,
      { ref: "7", now: NOW, threshold: 0.1 },
    );
    expect(logOutcome).toHaveBeenCalledTimes(1);
    expect(deps.stdout).toHaveBeenCalledWith(
      `Idea 0007 refuted (100 to 130); issue closed: ${ISSUE}\nThe change stays in place: evaluate never reverts.\nFollow-up idea: docs/ideas/0008-follow-up.md\n`,
    );
  });

  it("flags an inconclusive change and says it stays in place", async () => {
    vi.mocked(evaluateIdea).mockResolvedValue({
      status: "recorded",
      idea: "0007",
      result: "inconclusive",
      before: null,
      after: 3,
      concluded: {
        idea: "0007",
        result: "inconclusive",
        issue: ISSUE,
        published: { commented: true, labelled: true, closed: true },
      },
    });
    const { deps, result } = run({ idea: "7" });
    expect(await result).toBe(0);
    expect(deps.stdout).toHaveBeenCalledWith(
      `Idea 0007 inconclusive (none to 3); issue closed: ${ISSUE}\nFlagged: the change stays in place with outcome:inconclusive; no revert is issued.\n`,
    );
  });
});

describe("harness evaluate flags", () => {
  it("takes --threshold and --changed-by-pr", async () => {
    await run({ idea: "7", threshold: "0.25", "changed-by-pr": "77" }).result;
    expect(vi.mocked(evaluateIdea).mock.calls[0]?.[2]).toEqual({
      ref: "7",
      now: NOW,
      threshold: 0.25,
      changedByPr: 77,
    });
  });

  it.each([["abc"], ["-1"], ["0"]])(
    "rejects --threshold %s before reading anything",
    async (threshold) => {
      const { deps, result } = run({ idea: "7", threshold });
      expect(await result).toBe(2);
      expect(deps.stderr).toHaveBeenCalledWith(
        `Invalid --threshold "${threshold}". Use a fraction above 0 such as 0.1 for 10%.\n`,
      );
      expect(openLedger).not.toHaveBeenCalled();
      expect(evaluateIdea).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing --idea", async () => {
    const { deps, result } = run({});
    expect(await result).toBe(2);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Missing --idea; run `harness evaluate --idea <number or slug>`.\n",
    );
  });
});

describe("harness evaluate refusals and output", () => {
  it("refuses before the window ends, says when it can run, and logs nothing", async () => {
    vi.mocked(evaluateIdea).mockResolvedValue({
      status: "too-early",
      idea: "0007",
      evaluableAt: "2026-11-20T00:00:00.000Z",
    });
    const { deps, result } = run({ idea: "7" });
    expect(await result).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Idea 0007 is inside its measurement window; run `harness evaluate --idea 7` from 2026-11-20T00:00:00.000Z.\n",
    );
    expect(logOutcome).not.toHaveBeenCalled();
  });

  it("leaves a recorded outcome alone on a rerun and succeeds", async () => {
    vi.mocked(evaluateIdea).mockResolvedValue({
      status: "already-recorded",
      idea: "0007",
      result: "refuted",
    });
    const { deps, result } = run({ idea: "7" });
    expect(await result).toBe(0);
    expect(deps.stdout).toHaveBeenCalledWith(
      "Idea 0007 already has outcome refuted; left as recorded.\n",
    );
    expect(logOutcome).not.toHaveBeenCalled();
  });

  it("turns an IdeaError into an actionable message and a non-zero exit", async () => {
    vi.mocked(evaluateIdea).mockRejectedValue(new IdeaError("no such idea"));
    const { deps, result } = run({ idea: "7" }, true);
    expect(await result).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      `${JSON.stringify({ error: "no such idea" })}\n`,
    );
  });

  it("rethrows an error it does not expect", async () => {
    vi.mocked(evaluateIdea).mockRejectedValue(new Error("boom"));
    await expect(run({ idea: "7" }).result).rejects.toThrow("boom");
  });

  it("prints the result as one JSON object with --json", async () => {
    const { deps, result } = run({ idea: "7" }, true);
    expect(await result).toBe(0);
    const printed = JSON.parse(deps.stdout.mock.calls[0]?.[0] ?? "") as object;
    expect(printed).toMatchObject({
      status: "recorded",
      idea: "0007",
      result: "refuted",
      before: 100,
      after: 130,
    });
  });

  it("prints a too-early refusal as JSON on stderr with --json", async () => {
    vi.mocked(evaluateIdea).mockResolvedValue({
      status: "too-early",
      idea: "0007",
      evaluableAt: "2026-11-20T00:00:00.000Z",
    });
    const { deps, result } = run({ idea: "7" }, true);
    expect(await result).toBe(1);
    expect(JSON.parse(deps.stderr.mock.calls[0]?.[0] ?? "")).toEqual({
      status: "too-early",
      idea: "0007",
      evaluableAt: "2026-11-20T00:00:00.000Z",
    });
  });
});
