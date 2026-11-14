import { beforeEach, describe, expect, it, vi } from "vitest";
import { diffStat, selectDiff } from "../judge/index.js";
import { failed, prNumber, repoOf } from "./judge-shared.js";
import { diffCommands } from "./judge-diff-command.js";
import { contextOf, OK, REPO, ROOT } from "./judge-command-support.js";

vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  diffStat: vi.fn(),
  selectDiff: vi.fn(),
}));
vi.mock("./judge-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./judge-shared.js")>()),
  failed: vi.fn(),
  prNumber: vi.fn(),
  repoOf: vi.fn(),
}));

const RAW = "diff --git a/a.ts b/a.ts\n+x\n";
const STAT = [
  { path: "a.ts", added: 3, removed: 1 },
  { path: "docs/b.md", added: 10, removed: 0 },
];

/** An asymmetric matcher for an error whose message contains the text; the one cast, because expect's matchers are typed `any`. */
const messageContaining = (text: string): Error =>
  expect.objectContaining({
    message: expect.stringContaining(text),
  }) as Error;

/** A context whose gh answers `gh pr diff` with the raw diff. */
function setup(options: Record<string, string | boolean> = {}, json = false) {
  const made = contextOf("42", options, json);
  made.run.mockResolvedValue({ ...OK, stdout: RAW });
  return made;
}

beforeEach(() => {
  vi.mocked(failed).mockReturnValue(1);
  vi.mocked(prNumber).mockReturnValue(42);
  vi.mocked(repoOf).mockResolvedValue(REPO);
  vi.mocked(selectDiff).mockReturnValue("SELECTED");
  vi.mocked(diffStat).mockReturnValue(STAT);
});

describe("harness judge diff", () => {
  it("reads the PR diff through gh only, and prints the selected files' diff", async () => {
    const { context, run, stdout } = setup({ path: "src/**" });

    expect(await diffCommands.diff?.run(context)).toBe(0);
    expect(run.mock.calls).toEqual([
      ["gh", ["pr", "diff", "42", "--repo", REPO], { cwd: ROOT }],
    ]);
    expect(selectDiff).toHaveBeenCalledWith(RAW, ["src/**"]);
    expect(stdout).toHaveBeenCalledWith("SELECTED");
  });

  it("splits --path on commas into several globs, and passes none when it is absent", async () => {
    await diffCommands.diff?.run(setup({ path: "a/**, b.md" }).context);
    expect(selectDiff).toHaveBeenLastCalledWith(RAW, ["a/**", "b.md"]);

    await diffCommands.diff?.run(setup().context);
    expect(selectDiff).toHaveBeenLastCalledWith(RAW, []);
  });

  it("prints one line per file under --stat, and no diff text", async () => {
    const { context, stdout } = setup({ stat: true });

    expect(await diffCommands.diff?.run(context)).toBe(0);
    expect(stdout).toHaveBeenCalledWith(
      "a.ts | +3 -1\ndocs/b.md | +10 -0\n2 files changed\n",
    );
    expect(selectDiff).not.toHaveBeenCalled();
  });

  it("prints the stat as JSON under --stat --json", async () => {
    const { context, stdout } = setup({ stat: true }, true);

    await diffCommands.diff?.run(context);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ pr: 42, files: STAT })}\n`,
    );
  });

  it("prints the files and the selected diff as JSON under --json", async () => {
    const { context, stdout } = setup({}, true);

    await diffCommands.diff?.run(context);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ pr: 42, files: STAT, diff: "SELECTED" })}\n`,
    );
  });

  it("fails naming the globs when none of them matches a file", async () => {
    const { context, stdout, stderr } = setup({ path: "nope/**" });
    vi.mocked(diffStat).mockReturnValue([]);

    expect(await diffCommands.diff?.run(context)).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(context, messageContaining("nope/**"));
    expect(stderr).not.toHaveBeenCalled();
  });

  it("fails naming the step when gh cannot read the diff", async () => {
    const { context, run, stdout } = setup();
    run.mockResolvedValue({ code: 1, stdout: "", stderr: "not found\n" });

    expect(await diffCommands.diff?.run(context)).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(
      context,
      messageContaining("not found"),
    );
  });
});
