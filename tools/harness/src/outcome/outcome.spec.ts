import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IdeaError,
  issueTarget,
  outcomeSection,
  type Created,
} from "../idea/index.js";
import { closeOutcome, recordOutcome, type Context } from "./outcome.js";
import { followUpOf, markerFor, renderSection } from "./model.js";
import { publishOutcome } from "./publish.js";
import {
  fakeClock,
  fakeRepository,
  fakeRunner,
  ideaRecord,
  outcome,
  type RepositoryMocks,
} from "./outcome-support.js";

vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  outcomeSection: vi.fn(),
  issueTarget: vi.fn(),
}));
vi.mock("./model.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./model.js")>()),
  followUpOf: vi.fn(),
  markerFor: vi.fn(),
  renderSection: vi.fn(),
}));
vi.mock("./publish.js");

const ROOT = "/repo";
const TARGET = { number: "300", repo: "corekraft/kore" };
const MARKER = "<!-- harness outcome idea 0001 -->";
const PATH = "docs/ideas/0001-cache-the-probe-results.md";
const FOLLOW_UP_PATH =
  "docs/ideas/0002-follow-up-0001-cache-the-probe-results.md";
const SECTION = "## Outcome\n\nBODY";
const PUBLISHED = { commented: true, labelled: true, closed: true };
const FOLLOW_UP = {
  slug: "follow-up-0001-cache-the-probe-results",
  idea: {
    title: "Follow up: Cache the probe results",
    summary: "Follow up on idea 0001 after a refuted outcome",
    hypothesis: "After a refuted outcome on idea 0001, revisit: x",
    expectedOutcome: "Up time falls below 30s.",
    measurement: "kore local up p50 before and after.",
    safetyPattern: "no-behaviour-change",
    parent: "0001",
  },
};
const CREATED: Created = {
  created: true,
  record: ideaRecord({ number: "0002", path: FOLLOW_UP_PATH }),
};

/** A context whose repository already holds `record`; `repo` is the mocks behind it. */
function setUp(record = ideaRecord()): { ctx: Context; repo: RepositoryMocks } {
  const fake = fakeRepository();
  const ctx: Context = {
    repo: fake.repo,
    runner: fakeRunner(),
    clock: fakeClock(),
    root: ROOT,
  };
  fake.mocks.get.mockResolvedValue(record);
  fake.mocks.source.mockResolvedValue(`${SECTION}\n`);
  fake.mocks.create.mockResolvedValue(CREATED);
  return { ctx, repo: fake.mocks };
}

beforeEach(() => {
  vi.mocked(outcomeSection).mockReturnValue(SECTION);
  vi.mocked(issueTarget).mockResolvedValue(TARGET);
  vi.mocked(markerFor).mockReturnValue(MARKER);
  vi.mocked(renderSection).mockReturnValue("SECTION");
  vi.mocked(followUpOf).mockReturnValue(FOLLOW_UP);
  vi.mocked(publishOutcome).mockResolvedValue(PUBLISHED);
});

describe("recordOutcome refusals", () => {
  it("refuses an idea that already has an outcome, before any write, issue read or publish", async () => {
    const { ctx, repo } = setUp(ideaRecord({ outcome: "confirmed" }));
    await expect(recordOutcome(ctx, "1", outcome())).rejects.toThrow(
      new IdeaError(
        `${PATH} already has an outcome (confirmed); an outcome is recorded once. Run \`harness outcome close --idea 0001\` to finish publishing it.`,
      ),
    );
    expect(repo.recordOutcome).not.toHaveBeenCalled();
    expect(issueTarget).not.toHaveBeenCalled();
    expect(publishOutcome).not.toHaveBeenCalled();
  });

  it("resolves the issue before writing, so an idea with no issue changes nothing", async () => {
    const { ctx, repo } = setUp();
    const noIssue = new IdeaError("no issue");
    vi.mocked(issueTarget).mockRejectedValue(noIssue);
    await expect(recordOutcome(ctx, "1", outcome())).rejects.toBe(noIssue);
    expect(repo.recordOutcome).not.toHaveBeenCalled();
    expect(publishOutcome).not.toHaveBeenCalled();
  });
});

describe("recordOutcome writes then publishes", () => {
  it("looks the idea up by its reference and writes the rendered section, dated by the clock", async () => {
    const { ctx, repo } = setUp();
    await recordOutcome(ctx, "1", outcome());
    expect(repo.get).toHaveBeenCalledWith("1");
    expect(issueTarget).toHaveBeenCalledWith(ctx.runner, ROOT, ideaRecord());
    expect(renderSection).toHaveBeenCalledWith(outcome(), "2026-11-14");
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      ideaRecord(),
      "confirmed",
      "SECTION",
    );
  });

  it("publishes a confirmed outcome with the section as its comment, and makes no follow-up", async () => {
    const { ctx, repo } = setUp();
    const concluded = await recordOutcome(ctx, "1", outcome());
    expect(repo.source).toHaveBeenCalledWith(ideaRecord());
    expect(publishOutcome).toHaveBeenCalledWith(ctx.runner, ROOT, TARGET, {
      idea: "0001",
      result: "confirmed",
      marker: MARKER,
      comment: `${MARKER}\n\n${SECTION}\n`,
    });
    expect(followUpOf).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(concluded).toEqual({
      idea: "0001",
      result: "confirmed",
      issue: "https://github.com/corekraft/kore/issues/300",
      published: PUBLISHED,
    });
    expect(concluded).not.toHaveProperty("followUp");
  });

  it.each(["refuted", "inconclusive"] as const)(
    "creates a follow-up for a %s outcome and names it in the comment and the result",
    async (result) => {
      const { ctx, repo } = setUp();
      const concluded = await recordOutcome(ctx, "1", outcome({ result }));
      expect(followUpOf).toHaveBeenCalledWith(ideaRecord(), result);
      expect(repo.create).toHaveBeenCalledWith(FOLLOW_UP.slug, FOLLOW_UP.idea);
      expect(publishOutcome).toHaveBeenCalledWith(ctx.runner, ROOT, TARGET, {
        idea: "0001",
        result,
        marker: MARKER,
        comment: `${MARKER}\n\n${SECTION}\n\nFollow-up idea: ${FOLLOW_UP_PATH}\n`,
      });
      expect(concluded).toMatchObject({
        result,
        followUp: FOLLOW_UP_PATH,
      });
    },
  );

  it("posts only the marker and the follow-up when the idea file has no outcome section", async () => {
    const { ctx } = setUp();
    vi.mocked(outcomeSection).mockReturnValue(undefined);
    await recordOutcome(ctx, "1", outcome());
    expect(publishOutcome).toHaveBeenCalledWith(
      ctx.runner,
      ROOT,
      TARGET,
      expect.objectContaining({ comment: `${MARKER}\n\n\n` }),
    );
  });
});

describe("closeOutcome refusals", () => {
  it("refuses an idea with no recorded outcome, before any issue read or publish", async () => {
    const { ctx } = setUp();
    await expect(closeOutcome(ctx, "1")).rejects.toThrow(
      new IdeaError(
        `${PATH} has no recorded outcome, so its issue stays open. Run \`harness outcome record --idea 0001 --kind <experiment|usage|verification> --source <live-run|journal|eval-history|comparison> --evidence <reference> --result <confirmed|refuted|inconclusive> --summary <text>\`.`,
      ),
    );
    expect(issueTarget).not.toHaveBeenCalled();
    expect(publishOutcome).not.toHaveBeenCalled();
  });

  it("refuses a recorded line that is not a result, without reading the idea's section", async () => {
    const { ctx, repo } = setUp(ideaRecord({ outcome: "won" }));
    await expect(closeOutcome(ctx, "1")).rejects.toThrow(
      new IdeaError(
        `${PATH} has an outcome line "won" that the outcome tool did not write (it needs one of confirmed, refuted, inconclusive and an ## Outcome section). Remove it and run \`harness outcome record --idea 0001\`.`,
      ),
    );
    expect(repo.source).not.toHaveBeenCalled();
    expect(outcomeSection).not.toHaveBeenCalled();
    expect(publishOutcome).not.toHaveBeenCalled();
  });

  it("refuses a recorded result whose idea file has no outcome section", async () => {
    const { ctx } = setUp(ideaRecord({ outcome: "confirmed" }));
    vi.mocked(outcomeSection).mockReturnValue(undefined);
    await expect(closeOutcome(ctx, "1")).rejects.toThrow(
      new IdeaError(
        `${PATH} has an outcome line "confirmed" that the outcome tool did not write (it needs one of confirmed, refuted, inconclusive and an ## Outcome section). Remove it and run \`harness outcome record --idea 0001\`.`,
      ),
    );
    expect(publishOutcome).not.toHaveBeenCalled();
  });
});

describe("closeOutcome publishes the recorded outcome", () => {
  it("publishes a recorded confirmed outcome without writing the idea again", async () => {
    const { ctx, repo } = setUp(ideaRecord({ outcome: "confirmed" }));
    const concluded = await closeOutcome(ctx, "1");
    expect(issueTarget).toHaveBeenCalledWith(
      ctx.runner,
      ROOT,
      ideaRecord({ outcome: "confirmed" }),
    );
    expect(repo.recordOutcome).not.toHaveBeenCalled();
    expect(publishOutcome).toHaveBeenCalledWith(ctx.runner, ROOT, TARGET, {
      idea: "0001",
      result: "confirmed",
      marker: MARKER,
      comment: `${MARKER}\n\n${SECTION}\n`,
    });
    expect(concluded).toEqual({
      idea: "0001",
      result: "confirmed",
      issue: "https://github.com/corekraft/kore/issues/300",
      published: PUBLISHED,
    });
  });

  it("creates the follow-up of a recorded refuted outcome when it closes", async () => {
    const { ctx, repo } = setUp(ideaRecord({ outcome: "refuted" }));
    const concluded = await closeOutcome(ctx, "1");
    expect(followUpOf).toHaveBeenCalledWith(
      ideaRecord({ outcome: "refuted" }),
      "refuted",
    );
    expect(repo.create).toHaveBeenCalledWith(FOLLOW_UP.slug, FOLLOW_UP.idea);
    expect(concluded).toMatchObject({ followUp: FOLLOW_UP_PATH });
  });
});
