import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRunner, recordFixture } from "./idea-support.js";
import { withoutOutcome } from "./record.js";
import { issueTarget, renderBody } from "./sync.js";
import {
  BODY,
  PATH,
  REPO_VIEW,
  ROOT,
  TEXT,
  URL,
  reply,
  repoName,
} from "./sync-support.js";

// withoutOutcome is this domain's other unit: mocked.
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  withoutOutcome: vi.fn(),
}));

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
