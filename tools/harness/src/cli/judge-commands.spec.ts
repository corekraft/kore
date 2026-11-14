import { describe, expect, it, vi } from "vitest";
import { precheck, summary } from "../judge/index.js";
import { contextWith } from "./command-support.js";
import { judgeCommands } from "./judge-commands.js";
import { mergeCommands } from "./judge-merge-commands.js";
import {
  failed,
  FAILED,
  prNumber,
  record,
  repoOf,
  reviewersOf,
} from "./judge-shared.js";
import { REPO, reportOf, ROOT } from "./judge-command-support.js";

vi.mock("../judge/index.js");
vi.mock("./judge-merge-commands.js", () => ({
  mergeCommands: { merge: { summary: "merge" }, "send-back": { summary: "" } },
}));
vi.mock("./judge-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./judge-shared.js")>()),
  failed: vi.fn(),
  prNumber: vi.fn(),
  record: vi.fn(),
  repoOf: vi.fn(),
  reviewersOf: vi.fn(),
}));

const REPORT = reportOf();

function contextOf(json = false, operand: string | undefined = "42") {
  const stdout = vi.fn();
  const context = contextWith(
    { root: vi.fn().mockResolvedValue(ROOT), stdout },
    { reviewer: "bot" },
    json,
    operand,
  );
  return { context, stdout };
}

function ready() {
  vi.mocked(prNumber).mockReturnValue(42);
  vi.mocked(repoOf).mockResolvedValue(REPO);
  vi.mocked(reviewersOf).mockResolvedValue(["bot"]);
  vi.mocked(summary).mockReturnValue("SUMMARY");
}

describe("harness judge precheck", () => {
  it("runs the precheck on the PR, prints the summary, and records the verdict", async () => {
    const { context, stdout } = contextOf();
    ready();
    vi.mocked(precheck).mockResolvedValue(REPORT);

    expect(await judgeCommands.precheck?.run(context)).toBe(0);
    expect(prNumber).toHaveBeenCalledWith(
      "42",
      expect.stringContaining("Run `harness judge precheck <pr>"),
    );
    expect(precheck).toHaveBeenCalledWith(context, ROOT, REPO, 42, ["bot"]);
    expect(stdout).toHaveBeenCalledWith("SUMMARY");
    expect(record).toHaveBeenCalledWith(context, REPORT);
  });

  it("prints the report as JSON under --json", async () => {
    const { context, stdout } = contextOf(true);
    ready();
    vi.mocked(precheck).mockResolvedValue(REPORT);

    await judgeCommands.precheck?.run(context);
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(REPORT)}\n`);
  });

  it("fails with the failing exit code when the precheck does not pass, still printing and recording it", async () => {
    const { context, stdout } = contextOf();
    ready();
    vi.mocked(precheck).mockResolvedValue(reportOf({ ok: false }));

    expect(await judgeCommands.precheck?.run(context)).toBe(FAILED);
    expect(stdout).toHaveBeenCalledWith("SUMMARY");
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("hands an error to the shared failure reporter and returns what it returns", async () => {
    const { context } = contextOf(false, undefined);
    const error = new Error("no pr");
    vi.mocked(prNumber).mockImplementation(() => {
      throw error;
    });
    vi.mocked(failed).mockReturnValue(7);

    expect(await judgeCommands.precheck?.run(context)).toBe(7);
    expect(failed).toHaveBeenCalledWith(context, error);
    expect(precheck).not.toHaveBeenCalled();
  });
});

describe("judge command table", () => {
  it("lists the precheck and the merge commands, taking the merge table unchanged", () => {
    expect(Object.keys(judgeCommands)).toEqual(
      expect.arrayContaining(["precheck", "merge", "send-back"]),
    );
    expect(judgeCommands.merge).toBe(mergeCommands.merge);
    expect(judgeCommands["send-back"]).toBe(mergeCommands["send-back"]);
  });

  it("declares the precheck's operand and its reviewer flag", () => {
    expect(judgeCommands.precheck?.operand).toBe("pr");
    expect(judgeCommands.precheck?.options).toEqual({ reviewer: "string" });
    expect(judgeCommands.precheck?.summary).toContain(
      "principles-review counts only from the reviewers it names",
    );
  });
});
