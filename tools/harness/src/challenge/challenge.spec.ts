// Docs: infra/plans/11-agent-delivery-loop.md (Step 3, the challenge stage)
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { IdeaError, issueTarget } from "../idea/index.js";
import type { Runner } from "../runtime/index.js";
import { challengeIdea, issueComments, RoundLimit } from "./challenge.js";
import {
  CAPTURED_COMMENTS,
  fakeContext,
  fakeRunner,
  failed,
  ISSUE,
  ok,
  RECORD,
} from "./challenge-support.js";
import {
  distinctRounds,
  duplicateRounds,
  parseRounds,
  renderRound,
  type Round,
} from "./model.js";

vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  issueTarget: vi.fn(),
}));
vi.mock("./model.js");

const REPO = "corekraft/kore";
const USER = "junners";
const FIX = "Check `gh auth status`, then rerun `harness idea challenge`.";
const EMPTY_VIEW = '{"comments":[]}';

/** gh's answers when nothing is wrong: the user, an empty issue, a posted comment. */
const healthy = (args: readonly string[]) => {
  if (args[0] === "api") {
    return ok(`${USER}\n`);
  }
  return args[1] === "view" ? ok(EMPTY_VIEW) : ok();
};

const round = (n: number, objections: string[], url = `u${n}`): Round => ({
  round: n,
  objections,
  url,
});

/** The gh calls made, as argument lists, in order. */
const ghCalls = (run: Mock<Runner["run"]>) =>
  run.mock.calls.map((call) => call[1]);

beforeEach(() => {
  vi.mocked(issueTarget).mockResolvedValue({ number: "300", repo: REPO });
  vi.mocked(parseRounds).mockReturnValue([]);
  vi.mocked(distinctRounds).mockImplementation((rounds) => [...rounds]);
  vi.mocked(duplicateRounds).mockReturnValue([]);
  vi.mocked(renderRound).mockReturnValue("BODY");
});

describe("issueComments", () => {
  it("reads the body, author login and url of each comment in a captured gh payload", () => {
    expect(issueComments(CAPTURED_COMMENTS, ISSUE)).toEqual([
      {
        body: expect.stringContaining("Live boundary eval run on main"),
        author: "junners",
        url: "https://github.com/corekraft/kore/issues/192#issuecomment-6836363558",
      },
    ]);
  });

  it("gives a comment with no author an empty author and the issue's url when it has none", () => {
    const stdout = JSON.stringify({ comments: [{ body: "x", author: null }] });
    expect(issueComments(stdout, ISSUE)).toEqual([
      { body: "x", author: "", url: ISSUE },
    ]);
  });

  it("skips a comment with no text body, and reads nothing from a payload with no comment list", () => {
    const stdout = JSON.stringify({
      comments: [null, { url: "u" }, { body: 5 }],
    });
    expect(issueComments(stdout, ISSUE)).toEqual([]);
    expect(issueComments("{}", ISSUE)).toEqual([]);
    expect(issueComments('{"comments":{}}', ISSUE)).toEqual([]);
  });

  it("refuses output that is not JSON, naming the issue and the fix", () => {
    expect(() => issueComments("not json", ISSUE)).toThrow(
      new IdeaError(`gh returned unreadable output for issue ${ISSUE}; ${FIX}`),
    );
  });
});

describe("challengeIdea reading the issue", () => {
  it("resolves the issue through the runner, the root and the record", async () => {
    const { runner } = fakeRunner(healthy);
    await challengeIdea(fakeContext(runner), "1", ["a"]);
    expect(issueTarget).toHaveBeenCalledWith(runner, "/repo", RECORD);
  });

  it("names the user, then reads the issue's comments, before posting", async () => {
    const { runner, run } = fakeRunner(healthy);
    await challengeIdea(fakeContext(runner), "1", ["a"]);
    expect(ghCalls(run)).toEqual([
      ["api", "user", "--jq", ".login"],
      ["issue", "view", "300", "--repo", REPO, "--json", "comments"],
      ["issue", "comment", "300", "--repo", REPO, "--body-file", "-"],
      ["issue", "view", "300", "--repo", REPO, "--json", "comments"],
    ]);
  });

  it("counts the authenticated user's rounds from the comments it read", async () => {
    const { runner } = fakeRunner(healthy);
    await challengeIdea(fakeContext(runner), "1", ["a"]);
    expect(parseRounds).toHaveBeenNthCalledWith(1, "0001", [], USER);
  });

  it("refuses a request to read an issue that cannot be resolved, before any gh call", async () => {
    vi.mocked(issueTarget).mockRejectedValue(new IdeaError("no issue"));
    const { runner, run } = fakeRunner(healthy);
    await expect(
      challengeIdea(fakeContext(runner), "1", ["a"]),
    ).rejects.toThrow("no issue");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("challengeIdea round limit", () => {
  it("refuses a third round with the open objections of the last round, and posts nothing", async () => {
    const rounds = [round(1, ["a"]), round(2, ["b", "c"])];
    vi.mocked(parseRounds).mockReturnValue(rounds);
    vi.mocked(distinctRounds).mockReturnValue(rounds);
    const { runner, run } = fakeRunner(healthy);
    const refused = challengeIdea(fakeContext(runner), "1", ["d"]);
    await expect(refused).rejects.toBeInstanceOf(RoundLimit);
    await expect(refused).rejects.toMatchObject({
      rounds: 2,
      openObjections: ["b", "c"],
    });
    await expect(refused).rejects.toThrow(
      `Idea 0001 has used the limit of 2 challenge rounds, so it goes to a person to approve or reject (${ISSUE}).\nOpen objections:\n- b\n- c`,
    );
    expect(ghCalls(run).map((args) => args[1])).toEqual(["user", "view"]);
  });

  it("says no objections are open when the last round approved", async () => {
    const rounds = [round(1, ["a"]), round(2, [])];
    vi.mocked(distinctRounds).mockReturnValue(rounds);
    const { runner } = fakeRunner(healthy);
    await expect(
      challengeIdea(fakeContext(runner), "1", ["d"]),
    ).rejects.toThrow("No open objections.");
  });
});

describe("challengeIdea posting", () => {
  it("posts the rendered round as the comment body, counted as the next round", async () => {
    const { runner, run } = fakeRunner(healthy);
    await challengeIdea(fakeContext(runner), "1", ["a", "b"]);
    expect(renderRound).toHaveBeenCalledWith("0001", 1, ["a", "b"]);
    expect(run.mock.calls[2]?.[2]).toEqual({
      cwd: "/repo",
      input: "BODY",
    });
  });

  it("returns the round, its objections and the issue, with no duplicate", async () => {
    const { runner } = fakeRunner(healthy);
    const objections = ["a"];
    const result = await challengeIdea(fakeContext(runner), "1", objections);
    expect(result).toEqual({
      idea: "0001",
      round: 1,
      objections: ["a"],
      issue: ISSUE,
    });
    expect(result.objections).not.toBe(objections);
  });

  it("numbers the round after the rounds already recorded", async () => {
    vi.mocked(distinctRounds).mockReturnValue([round(1, ["a"])]);
    const { runner } = fakeRunner(healthy);
    const result = await challengeIdea(fakeContext(runner), "1", ["b"]);
    expect(renderRound).toHaveBeenCalledWith("0001", 2, ["b"]);
    expect(result.round).toBe(2);
  });

  it("reports a duplicate of this round after posting, naming both comments and which to keep", async () => {
    vi.mocked(duplicateRounds).mockReturnValue([
      { round: 1, urls: ["u1", "u2"] },
    ]);
    const { runner } = fakeRunner(healthy);
    const result = await challengeIdea(fakeContext(runner), "1", ["a"]);
    expect(result.duplicate).toContain(
      `Challenge round 1 on ${ISSUE} was posted twice and both comments are still on the issue: u1 and u2.`,
    );
    expect(result.duplicate).toContain("Keep u1 and delete u2;");
    expect(result.duplicate).toContain("Do not rerun for this round.");
  });

  it("ignores a duplicate of another round when reporting this one", async () => {
    vi.mocked(duplicateRounds).mockReturnValue([
      { round: 2, urls: ["u1", "u2"] },
    ]);
    const { runner } = fakeRunner(healthy);
    const result = await challengeIdea(fakeContext(runner), "1", ["a"]);
    expect(result).not.toHaveProperty("duplicate");
  });
});

describe("challengeIdea gh failures", () => {
  it.each([
    ["gh names an error", failed("not logged in"), ": not logged in."],
    ["gh names nothing", ok(""), "."],
  ])(
    "refuses to post when gh cannot name the user (%s), posting nothing",
    async (_, reply, detail) => {
      const { runner, run } = fakeRunner((args) =>
        args[0] === "api" ? reply : healthy(args),
      );
      await expect(
        challengeIdea(fakeContext(runner), "1", ["a"]),
      ).rejects.toThrow(
        `gh could not name the authenticated user${detail} ${FIX}`,
      );
      expect(ghCalls(run)).toEqual([["api", "user", "--jq", ".login"]]);
    },
  );

  it("names the issue and the error when gh cannot read it before posting", async () => {
    const { runner, run } = fakeRunner((args) =>
      args[0] === "api" ? ok(`${USER}\n`) : failed("rate limited"),
    );
    await expect(
      challengeIdea(fakeContext(runner), "1", ["a"]),
    ).rejects.toThrow(`gh could not read issue ${ISSUE}: rate limited. ${FIX}`);
    expect(ghCalls(run)).toHaveLength(2);
  });

  it("names the round and the error when gh rejects the comment, without a re-read", async () => {
    const { runner, run } = fakeRunner((args) =>
      args[1] === "comment" ? failed("forbidden") : healthy(args),
    );
    await expect(
      challengeIdea(fakeContext(runner), "1", ["a"]),
    ).rejects.toThrow(
      `gh could not post round 1 on ${ISSUE}: forbidden. ${FIX}`,
    );
    expect(ghCalls(run)).toHaveLength(3);
  });

  it("says not to rerun when the re-read after posting fails, since the round is already posted", async () => {
    let views = 0;
    const { runner, run } = fakeRunner((args) => {
      if (args[1] === "view" && ++views === 2) {
        return failed("rate limited");
      }
      return healthy(args);
    });
    await expect(
      challengeIdea(fakeContext(runner), "1", ["a"]),
    ).rejects.toThrow(
      `Round 1 was posted on ${ISSUE}, but gh could not read the issue again to check for a duplicate: rate limited. Do not rerun, which would post another round; check the issue by hand.`,
    );
    expect(ghCalls(run).filter((args) => args[1] === "comment")).toHaveLength(
      1,
    );
  });
});
