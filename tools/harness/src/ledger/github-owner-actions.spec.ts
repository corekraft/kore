import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRunner } from "./ledger-support.js";
import {
  LIMIT,
  asRecord,
  count,
  list,
  pages,
  when,
  type Raw,
} from "./github-gh.js";
import { fromActions } from "./github-owner-actions.js";

vi.mock("./github-gh.js");

const REPO = "corekraft/kore";
const OWNER = "junners";

/** The helpers, stubbed to what they promise: records, present times and whole counts. */
beforeEach(() => {
  vi.mocked(asRecord).mockImplementation((value) =>
    typeof value === "object" && value !== null ? (value as Raw) : {},
  );
  vi.mocked(when).mockImplementation((value) =>
    typeof value === "string" ? value : undefined,
  );
  vi.mocked(count).mockImplementation((value) =>
    Number.isSafeInteger(value) && (value as number) >= 1
      ? (value as number)
      : undefined,
  );
});

interface Listings {
  comments?: Raw[] | string;
  events?: Raw[] | string;
  prs?: Raw[] | string;
}

/** GitHub's three listings: comments and events through `pages`, pull requests through `list`. */
function listings({ comments = [], events = [], prs = [] }: Listings) {
  vi.mocked(pages).mockImplementation((_runner, what) =>
    Promise.resolve(what === "api issues/comments" ? comments : events),
  );
  vi.mocked(list).mockResolvedValue(prs);
}

const comment = (login: string, id = 5) => ({
  id,
  user: { login },
  created_at: "2026-01-02T03:00:00Z",
  issue_url: "https://api.github.com/repos/corekraft/kore/issues/7",
});

describe("fromActions: the owner's comments, events and reviews", () => {
  it("turns the owner's comment into an owner.action event with its issue number", async () => {
    listings({ comments: [comment(OWNER)] });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toEqual([
      {
        id: "github:owner.action:comment:5",
        source: "github",
        kind: "owner.action",
        occurredAt: "2026-01-02T03:00:00Z",
        number: 7,
      },
    ]);
  });

  it("turns the owner's issue event into an owner.action event for its issue", async () => {
    listings({
      events: [
        {
          id: 9,
          actor: { login: OWNER },
          created_at: "2026-01-03T00:00:00Z",
          issue: { number: 4 },
        },
      ],
    });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toEqual([
      {
        id: "github:owner.action:event:9",
        source: "github",
        kind: "owner.action",
        occurredAt: "2026-01-03T00:00:00Z",
        number: 4,
      },
    ]);
  });

  it("turns the owner's review into an owner.action event for its pull request", async () => {
    listings({
      prs: [
        {
          number: 12,
          reviews: [
            {
              id: 3,
              author: { login: OWNER },
              submittedAt: "2026-01-04T00:00:00Z",
            },
          ],
        },
      ],
    });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toEqual([
      {
        id: "github:owner.action:review:3",
        source: "github",
        kind: "owner.action",
        occurredAt: "2026-01-04T00:00:00Z",
        number: 12,
      },
    ]);
  });

  it("keeps no action of any other login", async () => {
    listings({ comments: [comment("someone-else")] });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toEqual([]);
  });
});

describe("fromActions: actions it cannot place", () => {
  it("drops an action with no time, or with no issue number", async () => {
    listings({
      comments: [
        { ...comment(OWNER), created_at: undefined },
        { ...comment(OWNER), issue_url: "https://example.test/nothing" },
      ],
    });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toEqual([]);
  });

  it("ignores reviews that are missing or not a list", async () => {
    listings({
      prs: [{ number: 1 }, { number: 2, reviews: "none" }],
    });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toEqual([]);
  });
});

describe("fromActions: the listings it asks GitHub for", () => {
  it("asks for comments and events since the time, and pull requests updated since its day", async () => {
    listings({});
    const runner = fakeRunner();
    await fromActions(runner, REPO, OWNER, "2026-01-01T00:00:00Z");
    expect(vi.mocked(pages).mock.calls).toEqual([
      [
        runner,
        "api issues/comments",
        "repos/corekraft/kore/issues/comments?sort=created&direction=desc&since=2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
      ],
      [
        runner,
        "api issues/events",
        "repos/corekraft/kore/issues/events",
        "2026-01-01T00:00:00Z",
      ],
    ]);
    expect(vi.mocked(list).mock.calls).toEqual([
      [
        runner,
        "pr list",
        [
          "pr",
          "list",
          "--repo",
          REPO,
          "--state",
          "all",
          "--limit",
          String(LIMIT),
          "--search",
          "updated:>=2026-01-01",
          "--json",
          "number,reviews",
        ],
      ],
    ]);
  });

  it("asks for everything, with no since, when none is given", async () => {
    listings({});
    await fromActions(fakeRunner(), REPO, OWNER);
    expect(vi.mocked(pages).mock.calls[0]?.[2]).toBe(
      "repos/corekraft/kore/issues/comments?sort=created&direction=desc",
    );
    expect(vi.mocked(list).mock.calls[0]?.[2]).not.toContain("--search");
  });
});

describe("fromActions: a listing that fails", () => {
  it("returns the comments' message and fetches nothing else", async () => {
    listings({ comments: "gh api issues/comments failed" });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toBe(
      "gh api issues/comments failed",
    );
    expect(vi.mocked(pages)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(list)).not.toHaveBeenCalled();
  });

  it("returns the events' message and does not list pull requests", async () => {
    listings({ events: "gh api issues/events failed" });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toBe(
      "gh api issues/events failed",
    );
    expect(vi.mocked(list)).not.toHaveBeenCalled();
  });

  it("returns the pull requests' message", async () => {
    listings({ prs: "gh pr list failed" });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toBe(
      "gh pr list failed",
    );
  });

  it("refuses a full pull request listing, since some reviews may be missing", async () => {
    listings({ prs: Array.from({ length: LIMIT }, () => ({ number: 1 })) });
    expect(await fromActions(fakeRunner(), REPO, OWNER)).toBe(
      "gh returned 200 pull requests, the most one poll lists, so some reviews may be missing. Pass --since with a later time.",
    );
  });
});
