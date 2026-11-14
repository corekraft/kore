import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRunner, recordFixture, type FakeRunner } from "./idea-support.js";
import { IdeaError, withoutOutcome, type IdeaRecord } from "./record.js";
import { issueTarget, renderBody, syncIssue } from "./sync.js";
import {
  BODY,
  PATH,
  REPO_VIEW,
  ROOT,
  TEXT,
  URL,
  VIEW_ARGS,
  createArgs,
  editArgs,
  reply,
  repoName,
  view,
} from "./sync-support.js";

// withoutOutcome is this domain's other unit: mocked. IdeaError stays real.
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  withoutOutcome: vi.fn(),
}));

const linked = recordFixture({
  issue: "https://github.com/other/repo/issues/5",
});
const sync = (
  runner: FakeRunner,
  record: IdeaRecord = recordFixture(),
  recordLink = vi.fn(),
) => syncIssue(runner, ROOT, record, TEXT, recordLink);

beforeEach(() => {
  vi.mocked(withoutOutcome).mockImplementation((text: string) => text);
});

describe("renderBody", () => {
  it("writes the generated banner and the five fields as sections, in order", () => {
    expect(renderBody(recordFixture(), TEXT)).toBe(BODY);
  });

  it("appends the author's prose, and never the text the outcome strip removed", () => {
    vi.mocked(withoutOutcome).mockReturnValue(
      "# Idea 0001: x\n\nAuthor prose.\n",
    );
    const body = renderBody(recordFixture(), "outcome text");
    expect(withoutOutcome).toHaveBeenCalledWith("outcome text");
    expect(body.endsWith("feature-flagged\n\nAuthor prose.\n")).toBe(true);
    expect(body).not.toContain("outcome text");
  });
});

describe("syncIssue creates an issue", () => {
  it("creates the issue in the checkout's repository and links it back", async () => {
    const runner = fakeRunner();
    const recordLink = vi.fn(() => Promise.resolve());
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(reply(`${URL}\n`));
    expect(await sync(runner, recordFixture(), recordLink)).toEqual({
      action: "created",
      issue: URL,
    });
    expect(runner.run.mock.calls).toEqual([
      ["gh", REPO_VIEW, { cwd: ROOT }],
      [
        "gh",
        createArgs("corekraft/kore", "Cache the probe results"),
        {
          cwd: ROOT,
          input: expect.stringContaining("## Hypothesis") as string,
        },
      ],
    ]);
    expect(recordLink.mock.calls).toEqual([[URL]]);
  });

  it("gives the repository hint when create names a repository problem", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(reply("", 1, "Could not resolve to a Repository"));
    await expect(sync(runner)).rejects.toThrow(
      "gh could not create the issue: Could not resolve to a Repository. Check the repository named above, then rerun `harness idea sync`.",
    );
  });

  it("gives the auth hint when create fails for any other reason", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(reply("", 1, "boom"));
    await expect(sync(runner)).rejects.toThrow(
      "gh could not create the issue: boom. Check `gh auth status` and rerun `harness idea sync`.",
    );
  });
});

describe("syncIssue refuses to record a link it cannot trust", () => {
  it("tells the user to check the issues, and records nothing, when create prints no link", async () => {
    const runner = fakeRunner();
    const recordLink = vi.fn(() => Promise.resolve());
    runner.run.mockResolvedValueOnce(repoName).mockResolvedValueOnce(reply(""));
    await expect(sync(runner, recordFixture(), recordLink)).rejects.toThrow(
      'gh reported success but printed no issue link, so the issue may exist: check the repository\'s issues for "Cache the probe results" in corekraft/kore, add `issue: <url>` to docs/ideas/0001-cache-the-probe-results.md, then rerun `harness idea sync`; otherwise a duplicate is created.',
    );
    expect(recordLink).not.toHaveBeenCalled();
  });

  it("names the created issue and the line to add when the link cannot be recorded", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(reply(`${URL}\n`));
    const recordLink = vi.fn(() => Promise.reject(new Error("disk full")));
    await expect(sync(runner, recordFixture(), recordLink)).rejects.toThrow(
      `Created ${URL} but could not record it in ${PATH}: disk full. Add \`issue: ${URL}\` to its frontmatter, then rerun \`harness idea sync\`; otherwise a second issue is created.`,
    );
  });

  it("reports a link failure that is not an Error by its text", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(reply(`${URL}\n`));
    const recordLink = vi.fn(() => Promise.reject("nope"));
    await expect(sync(runner, recordFixture(), recordLink)).rejects.toThrow(
      /could not record it in .*: nope\./,
    );
  });

  it("refuses a recorded issue that is neither a number nor a link, before calling gh", async () => {
    const runner = fakeRunner();
    await expect(
      sync(runner, recordFixture({ issue: "not-an-issue" })),
    ).rejects.toThrow(
      `${PATH} has issue "not-an-issue", which is not an issue number or link; set it to e.g. 123 or https://github.com/<owner>/<repo>/issues/123.`,
    );
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("syncIssue writes nothing when the issue already matches", () => {
  it("takes the repository from the link and asks gh nothing else", async () => {
    const runner = fakeRunner();
    const recordLink = vi.fn();
    runner.run.mockResolvedValueOnce(
      view("Cache the probe results", renderBody(linked, TEXT)),
    );
    expect(await sync(runner, linked, recordLink)).toEqual({
      action: "unchanged",
      issue: "https://github.com/other/repo/issues/5",
    });
    expect(runner.run.mock.calls).toEqual([["gh", VIEW_ARGS, { cwd: ROOT }]]);
    expect(recordLink).not.toHaveBeenCalled();
  });

  it("compares titles after trimming them, so padding alone is no change", async () => {
    const runner = fakeRunner();
    const padded = recordFixture({
      issue: "https://github.com/other/repo/issues/5",
      title: "  Cache the probe results  ",
    });
    runner.run.mockResolvedValueOnce(
      view("Cache the probe results", renderBody(padded, TEXT)),
    );
    expect((await sync(runner, padded)).action).toBe("unchanged");
  });

  it("resolves a bare number through the checkout's repository once", async () => {
    const runner = fakeRunner();
    const record = recordFixture({ issue: "#300" });
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(
        view("Cache the probe results", renderBody(record, TEXT)),
      );
    expect(await sync(runner, record)).toEqual({
      action: "unchanged",
      issue: "#300",
    });
    expect(runner.run.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["300", "--repo", "corekraft/kore"]),
    );
  });
});

describe("syncIssue rewrites an issue that differs", () => {
  it("rewrites the title and body when the body differs", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(view("Cache the probe results", "old"))
      .mockResolvedValueOnce(reply(""));
    expect((await sync(runner, linked)).action).toBe("updated");
    expect(runner.run.mock.calls[1]).toEqual([
      "gh",
      editArgs("Cache the probe results"),
      { cwd: ROOT, input: expect.stringContaining("## Summary") as string },
    ]);
  });

  it("treats a title or body that is not text as empty, so the issue is rewritten", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(reply(JSON.stringify({ title: 5, body: null })))
      .mockResolvedValueOnce(reply(""));
    expect((await sync(runner, linked)).action).toBe("updated");
  });

  it("creates the issue again when GitHub says the recorded one is gone", async () => {
    const runner = fakeRunner();
    const recordLink = vi.fn(() => Promise.resolve());
    runner.run
      .mockResolvedValueOnce(
        reply(
          "",
          1,
          "GraphQL: Could not resolve to an Issue with the number of 5.",
        ),
      )
      .mockResolvedValueOnce(reply(`${URL}\n`));
    expect(await sync(runner, linked, recordLink)).toEqual({
      action: "created",
      issue: URL,
    });
    expect(runner.run.mock.calls[1]?.[1]).toEqual(
      createArgs("other/repo", "Cache the probe results"),
    );
  });
});

describe("syncIssue fails with the gh message when gh does", () => {
  it("names the issue it could not read, for a failure that is not a missing issue", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce(reply("", 4, "gh: not logged in"));
    await expect(sync(runner, linked)).rejects.toThrow(
      "gh could not read issue https://github.com/other/repo/issues/5: gh: not logged in. Check `gh auth status` and rerun `harness idea sync`.",
    );
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it("names the issue it could not update when the edit is refused", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(view("other", "old"))
      .mockResolvedValueOnce(reply("", 1, "forbidden"));
    await expect(sync(runner, linked)).rejects.toThrow(
      "gh could not update issue https://github.com/other/repo/issues/5: forbidden. Check `gh auth status` and rerun `harness idea sync`.",
    );
  });

  it("refuses an unreadable view, asking for a rerun", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce(reply("not json"));
    await expect(sync(runner, linked)).rejects.toThrow(
      new IdeaError(
        "gh returned unreadable output for issue https://github.com/other/repo/issues/5; rerun `harness idea sync`.",
      ),
    );
  });

  it("says how to fix the checkout's repository when gh cannot name it", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce(reply("", 1, "no login"));
    await expect(sync(runner)).rejects.toThrow(
      "gh could not tell which repository this is: no login. Check `gh auth status` and rerun `harness idea sync`.",
    );
  });

  it("names the repository problem when gh returns a repository with no name", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce(reply("{}"));
    await expect(sync(runner)).rejects.toThrow(
      /gh could not tell which repository this is/,
    );
  });
});

describe("issueTarget", () => {
  it("names the sync command when the idea has no issue", async () => {
    await expect(
      issueTarget(fakeRunner(), ROOT, recordFixture()),
    ).rejects.toThrow(
      "docs/ideas/0001-cache-the-probe-results.md has no issue; run `harness idea sync --idea 0001` to create and link it first.",
    );
  });

  it("names the repository and points at it when gh says the repository is the problem", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce(reply("", 1, "no repository matched\n"));
    const record = recordFixture({ issue: "300" });
    await expect(issueTarget(runner, ROOT, record)).rejects.toThrow(
      "gh could not tell which repository this is: no repository matched. Check the repository named above, then rerun `harness idea sync`.",
    );
  });

  it("refuses an issue that is neither a number nor a link", async () => {
    await expect(
      issueTarget(fakeRunner(), ROOT, recordFixture({ issue: "nope" })),
    ).rejects.toThrow(
      `${PATH} has issue "nope", which is not an issue number or link;`,
    );
  });

  it("takes the number and repository from a link without asking gh", async () => {
    const runner = fakeRunner();
    const target = await issueTarget(
      runner,
      ROOT,
      recordFixture({ issue: URL }),
    );
    expect(target).toEqual({ number: "300", repo: "corekraft/kore" });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("resolves a bare number's repository with gh", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce(repoName);
    const target = await issueTarget(
      runner,
      ROOT,
      recordFixture({ issue: "300" }),
    );
    expect(target).toEqual({ number: "300", repo: "corekraft/kore" });
    expect(runner.run.mock.calls).toEqual([["gh", REPO_VIEW, { cwd: ROOT }]]);
  });
});
