import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATH,
  fakeClock,
  fakeFileSystem,
  fakeLedger,
  fakeRunner,
  recordsEverything,
} from "./ledger-support.js";
import {
  ISSUE,
  ISSUE_CALLS,
  ISSUE_LIST_ARGS,
  LABEL_CALLS,
  LABEL_EVENT,
  PR,
  PR_CALLS,
  answerGh,
  heldLock,
  known,
  type Gh,
} from "./github-poll-support.js";
import { acquire } from "./poll-lock.js";
import { isTimestamp } from "./schema.js";
import { pollGithub } from "./github-poll.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./poll-lock.js", () => ({ acquire: vi.fn() }));
vi.mock("./schema.js", () => ({ isTimestamp: vi.fn() }));

const REPO = "corekraft/kore";

/** One poll over fakes; `since` is passed only when the test gives one. */
function setup(gh: Gh, since?: string) {
  const runner = fakeRunner();
  answerGh(runner, gh);
  const { ledger, list, record } = fakeLedger();
  list.mockResolvedValue({ events: [], skipped: 0 });
  recordsEverything(record);
  const fs = fakeFileSystem();
  const clock = fakeClock();
  const poll = () =>
    pollGithub({
      ledger,
      runner,
      clock,
      fs,
      repo: REPO,
      ...(since === undefined ? {} : { since }),
    });
  return { runner, fake: { list, record }, fs, clock, poll };
}

/** The label-event listings that were read, by their gh call. */
const eventReads = (runner: ReturnType<typeof fakeRunner>) =>
  runner.run.mock.calls.filter((c) => c[1].join(" ").includes("issues/events"));

beforeEach(() => {
  vi.mocked(isTimestamp).mockReturnValue(true);
  vi.mocked(acquire).mockResolvedValue(heldLock());
});

describe("pollGithub: the lock", () => {
  it("polls under the ledger's lock file, beside the ledger", async () => {
    const { fs, clock, poll } = setup({});
    await poll();
    expect(vi.mocked(acquire)).toHaveBeenCalledWith(fs, clock, `${PATH}.lock`);
  });

  it("reports busy, and asks GitHub and records nothing, when another poll holds the lock", async () => {
    const { runner, fake, poll } = setup({});
    vi.mocked(acquire).mockResolvedValue({ ok: false, message: "held" });
    expect(await poll()).toEqual({ ok: false, message: "held" });
    expect(runner.run).not.toHaveBeenCalled();
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("releases the lock even when a gh call fails", async () => {
    const { poll } = setup({ failure: { code: 1, stderr: "boom" } });
    const held = heldLock();
    vi.mocked(acquire).mockResolvedValue(held);
    await poll();
    expect(held.release).toHaveBeenCalledTimes(1);
  });

  it("refreshes the lock after each gh call, so a long poll is not taken over", async () => {
    const { poll } = setup({});
    const held = heldLock();
    vi.mocked(acquire).mockResolvedValue(held);
    await poll();
    // Issues, pull requests and one event page.
    expect(held.refresh).toHaveBeenCalledTimes(3);
  });
});

describe("pollGithub: what it asks GitHub for", () => {
  it("lists by the updated day of the latest recorded GitHub event", async () => {
    const { runner, fake, poll } = setup({});
    fake.list.mockResolvedValue({
      events: [
        known("github:issue.opened:1", "2026-01-10T00:00:00Z"),
        known("github:pr.opened:2", "2026-01-12T08:00:00Z"),
      ],
      skipped: 0,
    });
    await poll();
    expect(runner.run.mock.calls[0]?.[1]).toEqual(ISSUE_LIST_ARGS);
  });

  it("uses the since it is given, over the latest recorded event", async () => {
    const { runner, poll } = setup({}, "2026-02-01T00:00:00Z");
    await poll();
    expect(runner.run.mock.calls[0]?.[1]).toContain("updated:>=2026-02-01");
  });
});

describe("pollGithub: how far back it reads label events", () => {
  it("reads at most three pages of label events", async () => {
    const page = Array.from({ length: 100 }, () => ({ event: "other" }));
    const { runner, poll } = setup({ events: [page, page, page, page] });
    await poll();
    expect(eventReads(runner)).toHaveLength(3);
  });

  it("stops reading event pages once one reaches back before since", async () => {
    const newer = Array.from({ length: 100 }, () => ({
      event: "other",
      created_at: "2026-02-05T00:00:00Z",
    }));
    const older = [{ event: "other", created_at: "2026-01-01T00:00:00Z" }];
    const { runner, poll } = setup(
      { events: [newer, older, newer] },
      "2026-02-01T00:00:00Z",
    );
    await poll();
    expect(eventReads(runner)).toHaveLength(2);
  });
});

describe("pollGithub: what it records", () => {
  it("records an issue as opened and then closed, in time order, with its number only", async () => {
    const { fake, poll } = setup({ issues: [ISSUE] });
    await poll();
    expect(fake.record.mock.calls).toEqual(ISSUE_CALLS);
  });

  it("records a pull request as opened and merged, under the issue it closes", async () => {
    const { fake, poll } = setup({ prs: [PR] });
    await poll();
    expect(fake.record.mock.calls).toEqual(PR_CALLS);
  });
});

describe("pollGithub: what it records from label events", () => {
  it("records a label event with its label name", async () => {
    const { fake, poll } = setup({ events: LABEL_EVENT });
    await poll();
    expect(fake.record.mock.calls).toEqual(LABEL_CALLS);
  });
});

describe("pollGithub: what it leaves out", () => {
  it("never records a title or a body", async () => {
    const { fake, poll } = setup({ issues: [ISSUE], prs: [PR] });
    await poll();
    expect(JSON.stringify(fake.record.mock.calls)).not.toContain("secret");
  });

  it("does not record what the ledger already holds", async () => {
    const { fake, poll } = setup({ issues: [ISSUE] });
    fake.list.mockResolvedValue({
      events: [known("github:issue.opened:7", "2026-01-05T00:00:00Z")],
      skipped: 0,
    });
    await poll();
    expect(fake.record.mock.calls.map((c) => c[0].kind)).toEqual([
      "issue.closed",
    ]);
  });

  it("drops a time that is not a timestamp, and a number that is not a count", async () => {
    const { fake, poll } = setup({
      issues: [
        { ...ISSUE, createdAt: "soon", closedAt: null },
        { ...ISSUE, number: 0, closedAt: null },
      ],
    });
    vi.mocked(isTimestamp).mockImplementation((value) => value !== "soon");
    expect(await poll()).toEqual({ ok: true, recorded: 0, events: [] });
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("stops at the first record the ledger refuses, and returns its message", async () => {
    const { fake, poll } = setup({ issues: [ISSUE] });
    fake.record.mockResolvedValue({
      ok: false,
      field: "kind",
      message: "bad kind",
    });
    expect(await poll()).toEqual({ ok: false, message: "bad kind" });
    expect(fake.record).toHaveBeenCalledTimes(1);
  });

  it("counts the events it recorded", async () => {
    const { poll } = setup({ issues: [ISSUE], prs: [PR] });
    expect(await poll()).toMatchObject({ ok: true, recorded: 4 });
  });
});

describe("pollGithub: a gh call that fails", () => {
  it("names the failed listing and records nothing after it", async () => {
    const { runner, fake, poll } = setup({
      failure: { code: 1, stderr: "boom" },
    });
    expect(await poll()).toEqual({
      ok: false,
      message:
        "gh issue list failed: exit code 1: boom. Is gh installed and logged in (gh auth status)?",
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("answers a rate limit with the time it resets", async () => {
    const { poll } = setup({
      failure: { code: 1, stderr: "API rate limit exceeded" },
      rateLimit: '{"resources":{"core":{"reset":1769904000}}}', // 2026-02-01T00:00:00Z
    });
    expect(await poll()).toEqual({
      ok: false,
      message:
        "gh issue list hit the GitHub rate limit. Retry after 2026-02-01T00:00:00.000Z; poll again then (gh api rate_limit shows the reset time).",
    });
  });

  it("says the gh version may have changed when a listing is not JSON", async () => {
    const { poll } = setup({ issues: "nope" });
    expect(await poll()).toEqual({
      ok: false,
      message:
        "gh issue list did not print JSON. Run it by hand and check the gh version.",
    });
  });

  it("refuses a full issue listing, since some may be missing", async () => {
    const { poll } = setup({
      issues: Array.from({ length: 1000 }, () => ISSUE),
    });
    expect(await poll()).toEqual({
      ok: false,
      message:
        "gh returned 1000 issues or PRs, the most one poll lists, so some may be missing. Pass a later --since, or raise LIMIT in github-poll.ts.",
    });
  });
});
