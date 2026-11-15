import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { fakeContext } from "./command-support.js";
import { ghIssueIo, openIssueIo } from "./approve-gh.js";
import { repoOf } from "./judge-shared.js";

vi.mock("./judge-shared.js");

function runner(stdout: string, code = 0) {
  const run = vi.fn<Runner["run"]>(() =>
    Promise.resolve({ code, stdout, stderr: code === 0 ? "" : "boom\n" }),
  );
  return { run, io: ghIssueIo({ run }, "corekraft/kore", "/repo") };
}

describe("ghIssueIo", () => {
  it("reads the label names of the issue", async () => {
    const { run, io } = runner('{"labels":[{"name":"harness"},{"name":"x"}]}');
    expect(await io.labels(215)).toEqual(["harness", "x"]);
    expect(run).toHaveBeenCalledWith(
      "gh",
      ["issue", "view", "215", "--repo", "corekraft/kore", "--json", "labels"],
      { cwd: "/repo" },
    );
  });

  it("reads the comment bodies of the issue", async () => {
    const { io } = runner('{"comments":[{"body":"a"},{"body":"b"}]}');
    expect(await io.comments(215)).toEqual(["a", "b"]);
  });

  it("posts a comment on the named repository", async () => {
    const { run, io } = runner("");
    await io.comment(215, "why");
    expect(run).toHaveBeenCalledWith(
      "gh",
      ["issue", "comment", "215", "--repo", "corekraft/kore", "--body", "why"],
      { cwd: "/repo" },
    );
  });

  it("adds only the ready-for-agent label", async () => {
    const { run, io } = runner("");
    await io.label(215);
    expect(run).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "edit",
        "215",
        "--repo",
        "corekraft/kore",
        "--add-label",
        "ready-for-agent",
      ],
      { cwd: "/repo" },
    );
  });

  it("names the failed call and how to recover when gh fails", async () => {
    const { io } = runner("", 1);
    await expect(io.label(215)).rejects.toThrow(
      "gh issue edit failed for issue #215: boom. Check `gh auth status` and the issue number, then rerun `harness approve`.",
    );
  });

  it("reports unreadable gh output instead of guessing", async () => {
    const { io } = runner("not json");
    await expect(io.labels(215)).rejects.toThrow(
      "gh returned unreadable labels for issue #215; rerun `harness approve`.",
    );
  });
});

describe("openIssueIo", () => {
  it("calls gh on the repository the bundle was built in, from the repository root", async () => {
    vi.mocked(repoOf).mockResolvedValue("corekraft/kore");
    const { context, deps } = fakeContext();
    const run = vi.fn<Runner["run"]>(() =>
      Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    );
    deps.runner = { run };

    await (await openIssueIo(context)).comment(215, "why");

    expect(run).toHaveBeenCalledWith(
      "gh",
      ["issue", "comment", "215", "--repo", "corekraft/kore", "--body", "why"],
      { cwd: "/repo" },
    );
  });
});
