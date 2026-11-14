import { beforeEach, describe, expect, it, vi } from "vitest";
import { failed, fakeRunner, ok } from "./ledger-support.js";
import { rateLimited } from "./github-poll.js";
import { isTimestamp } from "./schema.js";
import { asRecord, count, json, list, pages, when } from "./github-gh.js";

vi.mock("./schema.js");
vi.mock("./github-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./github-poll.js")>()),
  rateLimited: vi.fn<typeof rateLimited>(),
}));

beforeEach(() => {
  // Every listed date is a timestamp here, so paging reads the dates it is given.
  vi.mocked(isTimestamp).mockReturnValue(true);
});

describe("asRecord, when and count", () => {
  it("returns an object as it is, and any other value as an empty record", () => {
    const raw = { a: 1 };
    expect(asRecord(raw)).toBe(raw);
    expect(asRecord(null)).toEqual({});
    expect(asRecord("text")).toEqual({});
  });

  it("keeps a string only when the schema accepts it as a timestamp", () => {
    vi.mocked(isTimestamp).mockReturnValue(true);
    expect(when("2026-01-02T03:04:05Z")).toBe("2026-01-02T03:04:05Z");
    expect(vi.mocked(isTimestamp).mock.calls).toEqual([
      ["2026-01-02T03:04:05Z"],
    ]);
    vi.mocked(isTimestamp).mockReturnValue(false);
    expect(when("soon")).toBeUndefined();
    expect(when(5)).toBeUndefined();
  });

  it.each<[unknown, number | undefined]>([
    [3, 3],
    [1, 1],
    [0, undefined],
    [-1, undefined],
    [1.5, undefined],
    ["7", undefined],
  ])(
    "keeps a count only when it is a whole number of one or more: %j",
    (value, expected) => {
      expect(count(value)).toBe(expected);
    },
  );
});

describe("json", () => {
  it("returns the parsed output of a successful call", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(ok('{"a":1}'));
    expect(await json(runner, "api x", ["api", "x"])).toEqual({ a: 1 });
    expect(runner.run.mock.calls).toEqual([["gh", ["api", "x"]]]);
  });

  it("names the failed call and its stderr, and says how to check gh", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(failed(1, "boom"));
    expect(await json(runner, "api x", ["api", "x"])).toBe(
      "gh api x failed: boom. Is gh installed and logged in (gh auth status)?",
    );
    expect(rateLimited).not.toHaveBeenCalled();
  });

  it("falls back to the exit code when the call printed no text", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(failed(2, ""));
    expect(await json(runner, "pr list", ["pr"])).toBe(
      "gh pr list failed: exit code 2. Is gh installed and logged in (gh auth status)?",
    );
  });

  it("answers a rate limit with the rate limit message, not the cause", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(failed(1, "API rate limit exceeded"));
    vi.mocked(rateLimited).mockResolvedValue("rate limited");
    expect(await json(runner, "api x", ["api", "x"])).toBe("rate limited");
    expect(vi.mocked(rateLimited).mock.calls).toEqual([
      [{ runner, refresh: expect.any(Function) }, "api x"],
    ]);
  });

  it("says the gh version may have changed when the output is not JSON", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(ok("not json"));
    expect(await json(runner, "api x", ["api", "x"])).toBe(
      "gh api x did not print JSON; the gh version may have changed its output.",
    );
  });
});

describe("list", () => {
  it("returns each element as a record, so a non-object becomes an empty one", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(ok('[{"number":1},2,null]'));
    expect(await list(runner, "pr list", ["pr", "list"])).toEqual([
      { number: 1 },
      {},
      {},
    ]);
  });

  it("refuses output that is not a JSON array", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(ok('{"number":1}'));
    expect(await list(runner, "pr list", ["pr", "list"])).toBe(
      "gh pr list did not print a JSON list; the gh version may have changed its output.",
    );
  });

  it("passes a failed call's message through unchanged", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(failed(1, "nope"));
    expect(await list(runner, "pr list", ["pr", "list"])).toBe(
      "gh pr list failed: nope. Is gh installed and logged in (gh auth status)?",
    );
  });
});

/** Answers each page request with the next array of `pages`, by the page number in the path. */
function answerPages(
  runner: ReturnType<typeof fakeRunner>,
  ...listings: unknown[][]
) {
  runner.run.mockImplementation((_command, args) => {
    const page = Number(/&page=(\d+)/.exec(args.join(" "))?.[1]);
    return Promise.resolve(ok(JSON.stringify(listings[page - 1] ?? [])));
  });
}

const full = (createdAt: string) =>
  Array.from({ length: 100 }, () => ({ created_at: createdAt }));

describe("pages", () => {
  it("reads pages until one is short, and returns them all in order", async () => {
    const runner = fakeRunner();
    answerPages(runner, full("2026-01-05T00:00:00Z"), [{ id: 3 }]);
    const got = await pages(runner, "api x", "repos/a/b");
    expect(Array.isArray(got) && got.length).toBe(101);
    expect(runner.run.mock.calls.map((c) => c[1])).toEqual([
      ["api", "repos/a/b?per_page=100&page=1"],
      ["api", "repos/a/b?per_page=100&page=2"],
    ]);
  });

  it("uses & to join the paging query onto a path that already has one", async () => {
    const runner = fakeRunner();
    answerPages(runner, [{ id: 1 }]);
    await pages(runner, "api x", "repos/a/b?sort=created");
    expect(runner.run.mock.calls[0]?.[1]).toEqual([
      "api",
      "repos/a/b?sort=created&per_page=100&page=1",
    ]);
  });

  it("stops at a page whose oldest entry is at or before since", async () => {
    const runner = fakeRunner();
    answerPages(
      runner,
      full("2026-01-05T00:00:00Z"),
      full("2026-01-01T00:00:00Z"),
    );
    const got = await pages(
      runner,
      "api x",
      "repos/a/b",
      "2026-01-03T00:00:00Z",
    );
    expect(Array.isArray(got) && got.length).toBe(200);
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it("reads the committer date of a commit when there is no created_at", async () => {
    const runner = fakeRunner();
    const commits = Array.from({ length: 100 }, () => ({
      commit: { committer: { date: "2025-12-01T00:00:00Z" } },
    }));
    answerPages(runner, commits, [{ id: 9 }]);
    await pages(
      runner,
      "api commits",
      "repos/a/b/commits",
      "2026-01-01T00:00:00Z",
    );
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it("returns the message of the page that failed, and discards the earlier pages", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(ok(JSON.stringify(full("2026-01-05T00:00:00Z"))))
      .mockResolvedValueOnce(failed(1, "gone"));
    expect(await pages(runner, "api x", "repos/a/b")).toBe(
      "gh api x failed: gone. Is gh installed and logged in (gh auth status)?",
    );
  });
});

describe("pages limits", () => {
  it.each<[string | undefined, string]>([
    [
      undefined,
      "gh api x had more than 300 entries, so some would be missing. Pass --since with a later time.",
    ],
    [
      "2026-01-01T00:00:00Z",
      "gh api x had more than 300 entries since 2026-01-01T00:00:00Z, so some would be missing. Poll more often.",
    ],
  ])(
    "refuses a listing of more than three full pages, since %s",
    async (since, message) => {
      const runner = fakeRunner();
      answerPages(
        runner,
        full("2026-02-05T00:00:00Z"),
        full("2026-02-04T00:00:00Z"),
        full("2026-02-03T00:00:00Z"),
      );
      expect(await pages(runner, "api x", "repos/a/b", since)).toBe(message);
    },
  );
});
