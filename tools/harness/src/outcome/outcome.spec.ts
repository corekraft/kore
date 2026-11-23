import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IdeaError,
  issueTarget,
  outcomeSection,
  type Created,
} from "../idea/index.js";
import { APPROVAL_REFUSAL, type Sender } from "../sender/index.js";
import { recordOutcome, type Context } from "./outcome.js";
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

const SENDER: Sender = {
  command: "outcome record",
  session: { role: "orchestrator", name: "queue-x" },
};
const LINE = "sender: orchestrator queue-x (outcome record)";

/** A context whose repository already holds `record`; `repo` is the mocks behind it. */
function setUp(record = ideaRecord()): { ctx: Context; repo: RepositoryMocks } {
  const fake = fakeRepository();
  const ctx: Context = {
    repo: fake.repo,
    runner: fakeRunner(),
    clock: fakeClock(),
    root: ROOT,
    sender: SENDER,
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
  it("refuses a rerun whose result differs from the recorded one, before any write, issue read or publish", async () => {
    const { ctx, repo } = setUp(ideaRecord({ outcome: "confirmed" }));
    await expect(
      recordOutcome(ctx, "1", outcome({ result: "refuted" })),
    ).rejects.toThrow(
      new IdeaError(
        `${PATH} already has an outcome (confirmed), not refuted; an outcome is recorded once. To finish publishing it, rerun \`harness outcome record --idea 0001\` with --result confirmed.`,
      ),
    );
    expect(repo.recordOutcome).not.toHaveBeenCalled();
    expect(issueTarget).not.toHaveBeenCalled();
    expect(publishOutcome).not.toHaveBeenCalled();
  });

  it("refuses a section that carries guardrail approval syntax, before any write or publish", async () => {
    const { ctx, repo } = setUp();
    vi.mocked(renderSection).mockReturnValue(
      "Looks right.\napprove judge-checklist:audit>enforce",
    );
    await expect(recordOutcome(ctx, "1", outcome())).rejects.toThrow(
      new IdeaError(APPROVAL_REFUSAL),
    );
    expect(repo.recordOutcome).not.toHaveBeenCalled();
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
      comment: `${LINE}\n${MARKER}\n\n${SECTION}\n`,
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
        comment: `${LINE}\n${MARKER}\n\n${SECTION}\n\nFollow-up idea: ${FOLLOW_UP_PATH}\n`,
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
      expect.objectContaining({ comment: `${LINE}\n${MARKER}\n\n\n` }),
    );
  });
});

describe("rerunning recordOutcome on a recorded idea", () => {
  it("refuses a recorded line that is not a result, without reading the idea's section", async () => {
    const { ctx, repo } = setUp(ideaRecord({ outcome: "won" }));
    await expect(recordOutcome(ctx, "1", outcome())).rejects.toThrow(
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
    await expect(recordOutcome(ctx, "1", outcome())).rejects.toThrow(
      new IdeaError(
        `${PATH} has an outcome line "confirmed" that the outcome tool did not write (it needs one of confirmed, refuted, inconclusive and an ## Outcome section). Remove it and run \`harness outcome record --idea 0001\`.`,
      ),
    );
    expect(publishOutcome).not.toHaveBeenCalled();
  });

  it("finishes publishing a recorded confirmed outcome without writing the idea again", async () => {
    const { ctx, repo } = setUp(ideaRecord({ outcome: "confirmed" }));
    const concluded = await recordOutcome(ctx, "1", outcome());
    expect(issueTarget).toHaveBeenCalledWith(
      ctx.runner,
      ROOT,
      ideaRecord({ outcome: "confirmed" }),
    );
    expect(renderSection).not.toHaveBeenCalled();
    expect(repo.recordOutcome).not.toHaveBeenCalled();
    expect(publishOutcome).toHaveBeenCalledWith(ctx.runner, ROOT, TARGET, {
      idea: "0001",
      result: "confirmed",
      marker: MARKER,
      comment: `${LINE}\n${MARKER}\n\n${SECTION}\n`,
    });
    expect(concluded).toEqual({
      idea: "0001",
      result: "confirmed",
      issue: "https://github.com/corekraft/kore/issues/300",
      published: PUBLISHED,
    });
  });

  it("creates the follow-up of a recorded refuted outcome when it finishes", async () => {
    const { ctx, repo } = setUp(ideaRecord({ outcome: "refuted" }));
    const concluded = await recordOutcome(
      ctx,
      "1",
      outcome({ result: "refuted" }),
    );
    expect(followUpOf).toHaveBeenCalledWith(
      ideaRecord({ outcome: "refuted" }),
      "refuted",
    );
    expect(repo.create).toHaveBeenCalledWith(FOLLOW_UP.slug, FOLLOW_UP.idea);
    expect(repo.recordOutcome).not.toHaveBeenCalled();
    expect(concluded).toMatchObject({ followUp: FOLLOW_UP_PATH });
  });
});
