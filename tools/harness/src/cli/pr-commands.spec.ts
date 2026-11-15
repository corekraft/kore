import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPrBody, type PrBody } from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { failed, repoOf } from "./judge-shared.js";
import { prCommands, prOpenRun } from "./pr-commands.js";

vi.mock("../judge/index.js", () => ({
  JudgeError: class JudgeError extends Error {},
  renderPrBody: vi.fn<(input: unknown) => PrBody>(),
}));
vi.mock("./judge-shared.js", () => ({
  failed: vi.fn<(context: CommandContext, error: unknown) => number>(),
  repoOf: vi.fn<(context: CommandContext) => Promise<string>>(),
}));

const URL = "https://github.com/corekraft/kore/pull/9";

function fixture(options: Record<string, string | boolean>, json = false) {
  const run = vi.fn();
  run.mockResolvedValue({ code: 0, stdout: `${URL}\n`, stderr: "" });
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const context = {
    options,
    json,
    deps: {
      runner: { run },
      root: () => Promise.resolve("/repo"),
      stdout,
      stderr,
    },
  } as unknown as CommandContext;
  return { context, run, stdout, stderr };
}

const REQUIRED = {
  title: "feat: add pr open",
  body: "Summary.",
  pattern: "no-behaviour-change",
};

const refusedWith = (fragment: string) =>
  expect.objectContaining({
    message: expect.stringContaining(fragment) as unknown,
  });

beforeEach(() => {
  vi.mocked(repoOf).mockResolvedValue("corekraft/kore");
  vi.mocked(renderPrBody).mockReset();
  vi.mocked(renderPrBody).mockReturnValue({
    body: "RENDERED\n",
    warnings: [],
  });
  vi.mocked(failed).mockReset();
  vi.mocked(failed).mockReturnValue(1);
});

describe("harness pr open creates the PR through the runner with the rendered body", () => {
  it("passes the rendered body, title and repository to gh pr create and prints the URL", async () => {
    const f = fixture(REQUIRED);
    expect(await prOpenRun(f.context)).toBe(0);
    expect(f.run).toHaveBeenCalledWith(
      "gh",
      [
        "pr",
        "create",
        "--repo",
        "corekraft/kore",
        "--title",
        "feat: add pr open",
        "--body",
        "RENDERED\n",
      ],
      { cwd: "/repo" },
    );
    expect(f.stdout).toHaveBeenCalledWith(`${URL}\n`);
  });

  it("hands the options to the renderer as numbers and flags", async () => {
    const f = fixture({
      ...REQUIRED,
      issue: "746",
      idea: "abc",
      closes: true,
    });
    await prOpenRun(f.context);
    expect(renderPrBody).toHaveBeenCalledWith({
      body: "Summary.",
      pattern: "no-behaviour-change",
      issue: 746,
      idea: "abc",
      closes: true,
    });
  });

  it("passes the expand step as a number", async () => {
    const f = fixture({ ...REQUIRED, "expand-step": "700" });
    await prOpenRun(f.context);
    expect(renderPrBody).toHaveBeenCalledWith(
      expect.objectContaining({ expandStep: 700 }),
    );
  });

  it("adds --base and --head only when asked", async () => {
    const f = fixture({ ...REQUIRED, base: "main", head: "my-branch" });
    await prOpenRun(f.context);
    expect(f.run.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["--base", "main", "--head", "my-branch"]),
    );
  });

  it("reports the URL as JSON under --json", async () => {
    const f = fixture(REQUIRED, true);
    await prOpenRun(f.context);
    expect(f.stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ url: URL, warnings: [] })}\n`,
    );
  });
});

describe("harness pr open creates nothing it would have to refuse", () => {
  it("creates no PR when the renderer refuses the contract", async () => {
    const f = fixture(REQUIRED);
    const refusal = new Error("names no expand step");
    vi.mocked(renderPrBody).mockImplementation(() => {
      throw refusal;
    });
    expect(await prOpenRun(f.context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(f.context, refusal);
    expect(f.run).not.toHaveBeenCalled();
  });

  it("refuses a missing --title with usage and creates no PR", async () => {
    const f = fixture({ pattern: "no-behaviour-change" });
    await prOpenRun(f.context);
    expect(failed).toHaveBeenCalledWith(f.context, refusedWith("--title"));
    expect(f.run).not.toHaveBeenCalled();
  });

  it("refuses a missing --pattern with usage and creates no PR", async () => {
    const f = fixture({ title: "feat: x" });
    await prOpenRun(f.context);
    expect(failed).toHaveBeenCalledWith(f.context, refusedWith("--pattern"));
    expect(f.run).not.toHaveBeenCalled();
  });

  it("refuses an issue that is not a number and creates no PR", async () => {
    const f = fixture({ ...REQUIRED, issue: "abc" });
    await prOpenRun(f.context);
    expect(failed).toHaveBeenCalledWith(f.context, refusedWith("--issue"));
    expect(f.run).not.toHaveBeenCalled();
  });

  it("reports a gh failure with what to check", async () => {
    const f = fixture(REQUIRED);
    f.run.mockResolvedValue({ code: 1, stdout: "", stderr: "no auth" });
    await prOpenRun(f.context);
    expect(failed).toHaveBeenCalledWith(
      f.context,
      refusedWith("gh auth status"),
    );
  });
});

describe("harness pr open warns and previews", () => {
  it("prints each warning on stderr and still creates the PR", async () => {
    const f = fixture(REQUIRED);
    vi.mocked(renderPrBody).mockReturnValue({
      body: "B\n",
      warnings: ["ADR 0079 warning"],
    });
    expect(await prOpenRun(f.context)).toBe(0);
    expect(f.stderr).toHaveBeenCalledWith("warning: ADR 0079 warning\n");
    expect(f.run).toHaveBeenCalled();
  });

  it("prints the body and creates nothing under --dry-run", async () => {
    const f = fixture({ ...REQUIRED, "dry-run": true });
    expect(await prOpenRun(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith("RENDERED\n");
    expect(f.run).not.toHaveBeenCalled();
  });
});

describe("harness pr open is declared as a mutating command", () => {
  it("names its options in the usage text", () => {
    const open = prCommands["open"];
    expect(open?.summary).toMatch(/^mutates;/);
    expect(Object.keys(open?.options ?? {}).sort()).toEqual([
      "base",
      "body",
      "closes",
      "dry-run",
      "expand-step",
      "head",
      "idea",
      "issue",
      "pattern",
      "title",
    ]);
  });
});
