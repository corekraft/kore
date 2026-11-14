// Docs: infra/plans/11-agent-delivery-loop.md (Step 3, the challenge stage)
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  challengeIdea,
  parseObjections,
  RoundLimit,
} from "../challenge/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import type { CommandContext } from "../runtime/index.js";
import { challenge } from "./challenge-commands.js";
import { openLedger } from "./ledger-commands.js";
import { fakeContext, fakeLedger, NOW } from "./command-support.js";

vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  IdeaRepository: vi.fn(),
}));
vi.mock("../challenge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../challenge/index.js")>()),
  challengeIdea: vi.fn(),
  parseObjections: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const ISSUE = "https://github.com/corekraft/kore/issues/300";
const FAILED = 1;
const IDEA = { options: { idea: "1" } };

/** A round that was posted, with the objections it recorded. */
const posted = (objections: string[], round = 1) => ({
  idea: "0001",
  round,
  objections,
  issue: ISSUE,
});

/** A context for `challenge` with the given stdin and options, its ledger recording ok. */
function roundContext(overrides: Partial<CommandContext> = {}, stdin = "") {
  const built = fakeContext({ options: IDEA.options, ...overrides });
  built.deps.stdin = () => Promise.resolve(stdin);
  return built;
}

beforeEach(() => {
  vi.mocked(parseObjections).mockImplementation((input) =>
    input.split("\n").filter((line) => line !== ""),
  );
  vi.mocked(challengeIdea).mockResolvedValue(posted(["a"]));
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
});

describe("challenge refusals before posting", () => {
  it.each([
    ["no --idea", {}],
    ["a blank --idea", { idea: "   " }],
  ])("refuses %s, naming the usage, and posts nothing", async (_, options) => {
    const { context, err } = roundContext({ options }, "a\n");
    expect(await challenge.run(context)).toBe(FAILED);
    expect(err()).toMatch(/^Missing --idea; run `harness idea challenge/);
    expect(challengeIdea).not.toHaveBeenCalled();
  });

  it("refuses an empty objection list without --approve, naming both ways out", async () => {
    const { context, err } = roundContext({}, "\n");
    expect(await challenge.run(context)).toBe(FAILED);
    expect(err()).toMatch(
      /^No objections given: pipe them on stdin.*--approve/,
    );
    expect(challengeIdea).not.toHaveBeenCalled();
  });

  it("reads no stdin and posts an approval with --approve", async () => {
    const { context, deps } = roundContext({
      options: { idea: "1", approve: true },
    });
    const stdin = vi.fn(() => Promise.resolve("ignored"));
    deps.stdin = stdin;
    expect(await challenge.run(context)).toBe(0);
    expect(stdin).not.toHaveBeenCalled();
    expect(challengeIdea).toHaveBeenCalledWith(expect.anything(), "1", []);
  });

  it("refuses when no ledger can be opened, posting nothing", async () => {
    vi.mocked(openLedger).mockResolvedValue({ error: "no ledger here" });
    const { context, err } = roundContext({}, "a\n");
    expect(await challenge.run(context)).toBe(FAILED);
    expect(err()).toBe("no ledger here\n");
    expect(challengeIdea).not.toHaveBeenCalled();
  });

  it("names the failure of finding the repository root, whatever its type", async () => {
    const { context, deps, err } = roundContext({}, "a\n");
    deps.root = () => Promise.reject("no checkout");
    expect(await challenge.run(context)).toBe(FAILED);
    expect(err()).toBe("no checkout\n");
    expect(challengeIdea).not.toHaveBeenCalled();
  });

  it("rethrows a failure that is not an idea error", async () => {
    vi.mocked(challengeIdea).mockRejectedValue(new Error("gh exploded"));
    const { context } = roundContext({}, "a\n");
    await expect(challenge.run(context)).rejects.toThrow("gh exploded");
  });
});

describe("challenge posting", () => {
  it("resolves the trimmed idea through the repository at the root, with the objections", async () => {
    const { context, deps } = roundContext(
      { options: { idea: " 1 " } },
      "a\nb\n",
    );
    await challenge.run(context);
    expect(IdeaRepository).toHaveBeenCalledWith(deps.fs, deps.clock, "/repo");
    expect(challengeIdea).toHaveBeenCalledWith(
      { repo: expect.any(IdeaRepository), runner: deps.runner, root: "/repo" },
      "1",
      ["a", "b"],
    );
  });

  it("records the round in the ledger against the idea and the challenge stage", async () => {
    const ledger = fakeLedger();
    vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
    vi.mocked(challengeIdea).mockResolvedValue(posted(["a", "b"]));
    const { context } = roundContext({}, "a\nb\n");
    expect(await challenge.run(context)).toBe(0);
    expect(ledger.write.mock.calls).toEqual([
      [
        {
          source: "claude",
          kind: "challenge.round",
          occurredAt: NOW,
          idea: "0001",
          stage: "challenge",
          number: 1,
          label: "objections:2",
        },
      ],
    ]);
  });

  it.each([
    [1, ["a"], "1 open objection"],
    [1, ["a", "b"], "2 open objections"],
    [2, [], "no open objections"],
  ])("prints round %i with %j as %s", async (round, objections, summary) => {
    vi.mocked(challengeIdea).mockResolvedValue(posted(objections, round));
    const { context, out } = roundContext({}, "x\n");
    expect(await challenge.run(context)).toBe(0);
    expect(out()).toBe(
      `Challenge round ${round} of 2 posted on ${ISSUE}: ${summary}\n`,
    );
  });

  it("prints the posted round as JSON with --json", async () => {
    const { context, out } = roundContext({ json: true }, "a\n");
    expect(await challenge.run(context)).toBe(0);
    expect(JSON.parse(out())).toEqual(posted(["a"]));
  });
});

describe("challenge failures after posting", () => {
  it("refuses a rejected ledger event after the round was posted, and says not to rerun", async () => {
    const rejected = fakeLedger([], {
      ok: false,
      field: "idea",
      message: "bad.",
    });
    vi.mocked(openLedger).mockResolvedValue({ ledger: rejected.ledger });
    const { context, err } = roundContext({}, "a\n");
    expect(await challenge.run(context)).toBe(FAILED);
    expect(err()).toBe(
      `Round 1 was posted on ${ISSUE}, but its ledger event was rejected: bad. Fix the ledger; do not rerun, which would post another round.\n`,
    );
  });

  it("refuses a round that another comment duplicated, printing the duplicate note and no success", async () => {
    vi.mocked(challengeIdea).mockResolvedValue({
      ...posted(["a"]),
      duplicate:
        "Round 1 was posted twice. Keep the first and delete the second.",
    });
    const { context, out, err } = roundContext({}, "a\n");
    expect(await challenge.run(context)).toBe(FAILED);
    expect(err()).toBe(
      "Round 1 was posted twice. Keep the first and delete the second.\n",
    );
    expect(out()).toBe("");
  });
});

describe("challenge refusal of a third round", () => {
  const limit = new RoundLimit(
    2,
    ["b"],
    "Idea 0001 has used the limit of 2 challenge rounds.",
  );

  beforeEach(() => {
    vi.mocked(challengeIdea).mockRejectedValue(limit);
  });

  it("prints the limit message on stderr, without JSON, by default", async () => {
    const { context, err } = roundContext({}, "c\n");
    expect(await challenge.run(context)).toBe(FAILED);
    expect(err()).toBe(`${limit.message}\n`);
  });

  it("prints the rounds and open objections as one JSON line before the message with --json", async () => {
    const { context, err } = roundContext({ json: true }, "c\n");
    expect(await challenge.run(context)).toBe(FAILED);
    const [first, second] = err().split("\n");
    expect(JSON.parse(first ?? "")).toEqual({
      error: limit.message,
      rounds: 2,
      openObjections: ["b"],
    });
    expect(second).toBe(limit.message);
  });

  it("names only the error for an ordinary idea error with --json", async () => {
    vi.mocked(challengeIdea).mockRejectedValue(new IdeaError("no issue"));
    const { context, err } = roundContext({ json: true }, "a\n");
    expect(await challenge.run(context)).toBe(FAILED);
    expect(JSON.parse(err().split("\n")[0] ?? "")).toEqual({
      error: "no issue",
    });
  });
});
