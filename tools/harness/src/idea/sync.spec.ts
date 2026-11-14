import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { IdeaError, type IdeaRecord } from "./record.js";
import { issueTarget } from "./sync.js";

const ROOT = "/repo";
const PATH = "docs/ideas/0001-cache-the-probe-results.md";

function recordWith(issue: string | undefined): IdeaRecord {
  return {
    number: "0001",
    slug: "cache-the-probe-results",
    path: PATH,
    title: "Cache the probe results",
    summary: "Probes repeat work.",
    hypothesis: "Caching cuts up time.",
    expectedOutcome: "Up time falls below 30s.",
    measurement: "kore local up p50 before and after.",
    safetyPattern: "no-behaviour-change",
    date: "2026-11-01",
    ...(issue === undefined ? {} : { issue }),
  };
}

/** A runner whose every call prints `stdout`, exits with `code` and says `stderr`. */
function fakeRunner(stdout = "", stderr = "", code = 0) {
  const run = vi.fn<Runner["run"]>(() =>
    Promise.resolve({ stdout, stderr, code }),
  );
  const runner: Runner = { run };
  return { runner, run };
}

describe("issueTarget refusals", () => {
  it("refuses an idea with no issue, before any gh call, and names the sync that links it", async () => {
    const { runner, run } = fakeRunner();
    await expect(
      issueTarget(runner, ROOT, recordWith(undefined)),
    ).rejects.toThrow(
      new IdeaError(
        `${PATH} has no issue; run \`harness idea sync --idea 0001\` to create and link it first.`,
      ),
    );
    expect(run.mock.calls).toEqual([]);
  });

  it("refuses an issue that is neither a number nor a link, naming the forms it accepts", async () => {
    const { runner, run } = fakeRunner();
    await expect(
      issueTarget(runner, ROOT, recordWith("not-an-issue")),
    ).rejects.toThrow(
      new IdeaError(
        `${PATH} has issue "not-an-issue", which is not an issue number or link; set it to e.g. 123 or https://github.com/<owner>/<repo>/issues/123.`,
      ),
    );
    expect(run.mock.calls).toEqual([]);
  });
});

describe("issueTarget resolves the repository", () => {
  it("takes the number and repository from a link, with no gh call", async () => {
    const { runner, run } = fakeRunner();
    expect(
      await issueTarget(
        runner,
        ROOT,
        recordWith("https://github.com/corekraft/kore/issues/300"),
      ),
    ).toEqual({ number: "300", repo: "corekraft/kore" });
    expect(run.mock.calls).toEqual([]);
  });

  it("asks gh for the repository, run in the root, when the issue is a bare number", async () => {
    const { runner, run } = fakeRunner(
      JSON.stringify({ nameWithOwner: "corekraft/kore" }),
    );
    expect(await issueTarget(runner, ROOT, recordWith("#300"))).toEqual({
      number: "300",
      repo: "corekraft/kore",
    });
    expect(run.mock.calls).toEqual([
      ["gh", ["repo", "view", "--json", "nameWithOwner"], { cwd: ROOT }],
    ]);
  });

  it("names the repository and points at it when gh says the repository is the problem", async () => {
    const { runner } = fakeRunner(
      "",
      "no repository matched in this directory\n",
      1,
    );
    await expect(issueTarget(runner, ROOT, recordWith("300"))).rejects.toThrow(
      new IdeaError(
        "gh could not tell which repository this is: no repository matched in this directory. Check the repository named above, then rerun `harness idea sync`.",
      ),
    );
  });

  it("names the failure with the auth fix when gh cannot tell the repository for another reason", async () => {
    const { runner } = fakeRunner("", "HTTP 502\n", 1);
    await expect(issueTarget(runner, ROOT, recordWith("300"))).rejects.toThrow(
      new IdeaError(
        "gh could not tell which repository this is: HTTP 502. Check `gh auth status` and rerun `harness idea sync`.",
      ),
    );
  });
});
