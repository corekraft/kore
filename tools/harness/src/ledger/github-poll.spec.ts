import { describe, expect, it } from "vitest";
import {
  fullPage,
  issue,
  labelled,
  PATH,
  pr,
  REPO,
  setup,
} from "./github-poll-support.js";

describe("pollGithub events", () => {
  it("records an opened issue at GitHub's creation time", async () => {
    const t = setup();
    t.gh.issues = [issue(7, "2026-01-05T10:00:00Z")];
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 1 });
    const [event] = await t.stored();
    expect(event).toMatchObject({
      source: "github",
      kind: "issue.opened",
      number: 7,
      occurredAt: "2026-01-05T10:00:00Z",
    });
  });

  it("records a label event with its label and issue number", async () => {
    const t = setup();
    t.gh.events = [
      [labelled(11, 7, "2026-01-05T11:00:00Z", "ready-for-agent")],
    ];
    await t.poll();
    expect((await t.stored())[0]).toMatchObject({
      kind: "issue.labelled",
      number: 7,
      label: "ready-for-agent",
      occurredAt: "2026-01-05T11:00:00Z",
    });
  });

  it("ignores timeline events that are not labelling", async () => {
    const t = setup();
    t.gh.events = [
      [
        {
          id: 1,
          event: "closed",
          created_at: "2026-01-05T11:00:00Z",
          issue: { number: 7 },
        },
        {
          id: 2,
          event: "labeled",
          created_at: "2026-01-05T11:00:00Z",
          label: { name: "x" },
        },
      ],
    ];
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 0 });
  });

  it("records an opened PR, and a merged PR at its merge time", async () => {
    const t = setup();
    t.gh.prs = [
      pr(9, "2026-01-06T10:00:00Z", "2026-01-06T12:00:00Z"),
      pr(10, "2026-01-06T13:00:00Z"),
    ];
    await t.poll();
    expect((await t.summary()).sort()).toEqual([
      "pr.merged:9",
      "pr.opened:10",
      "pr.opened:9",
    ]);
    const merged = (await t.stored()).find((e) => e.kind === "pr.merged");
    expect(merged?.occurredAt).toBe("2026-01-06T12:00:00Z");
  });
});

describe("pollGithub idempotence and --since", () => {
  it("appends nothing when polled again", async () => {
    const t = setup();
    t.gh.issues = [issue(7, "2026-01-05T10:00:00Z")];
    t.gh.prs = [pr(9, "2026-01-06T10:00:00Z", "2026-01-06T12:00:00Z")];
    t.gh.events = [[labelled(11, 7, "2026-01-05T11:00:00Z", "bug")]];
    await t.poll();
    const before = await t.summary();
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 0 });
    expect(await t.summary()).toEqual(before);
  });

  it("records a PR's merge on a later poll without repeating its opening", async () => {
    const t = setup();
    t.gh.prs = [pr(9, "2026-01-06T10:00:00Z")];
    await t.poll();
    t.gh.prs = [pr(9, "2026-01-06T10:00:00Z", "2026-01-06T12:00:00Z")];
    await t.poll();
    expect(await t.summary()).toEqual(["pr.opened:9", "pr.merged:9"]);
  });

  it("bounds the issue and PR lists by the latest recorded event, issues and PRs by update", async () => {
    const t = setup();
    t.gh.issues = [issue(1, "2026-01-05T10:00:00Z")];
    await t.poll();
    await t.poll();
    const [issues, prs] = t.calls().slice(-3);
    expect(issues).toContain("--search updated:>=2026-01-05");
    expect(prs).toContain("--search updated:>=2026-01-05");
  });

  it("lists everything on the first poll, with no search", async () => {
    const t = setup();
    await t.poll();
    expect(t.calls().join("\n")).not.toContain("--search");
  });

  it("bounds the fetch by an explicit --since over the ledger", async () => {
    const t = setup();
    t.gh.issues = [issue(1, "2026-01-05T10:00:00Z")];
    await t.poll();
    await t.poll("2026-01-06T00:00:00Z");
    expect(t.calls().slice(-3)[0]).toContain("updated:>=2026-01-06");
  });

  it("uses since only to bound the fetch: whatever gh returns is recorded once, by id", async () => {
    const t = setup();
    t.gh.issues = [
      issue(1, "2026-01-05T10:00:00Z"),
      issue(2, "2026-01-08T10:00:00Z"),
    ];
    await t.poll("2026-01-06T00:00:00Z");
    await t.poll("2026-01-06T00:00:00Z");
    expect(await t.summary()).toEqual(["issue.opened:1", "issue.opened:2"]);
  });

  it("passes --repo on every gh call", async () => {
    const t = setup();
    await t.poll();
    expect(t.runner.calls.length).toBeGreaterThan(0);
    for (const call of t.runner.calls) {
      expect(call.command).toBe("gh");
      expect(call.args.join(" ")).toMatch(
        new RegExp(`--repo ${REPO}|repos/${REPO}/`),
      );
    }
  });
});

describe("pollGithub stored fields and failures", () => {
  it("stores only identifiers, labels, numbers and times", async () => {
    const t = setup();
    t.gh.issues = [issue(7, "2026-01-05T10:00:00Z")];
    t.gh.prs = [pr(9, "2026-01-06T10:00:00Z")];
    t.gh.events = [[labelled(11, 7, "2026-01-05T11:00:00Z", "bug")]];
    await t.poll();
    const text = t.fs.files.get(PATH) ?? "";
    expect(text).not.toContain("secret");
  });

  it("names a gh failure and writes nothing", async () => {
    const t = setup();
    t.gh.issues = [issue(7, "2026-01-05T10:00:00Z")];
    t.gh.code = 1;
    const result = await t.poll();
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("gh auth status");
    expect(t.fs.files.has(PATH)).toBe(false);
  });

  it("releases the lock so the next poll runs", async () => {
    const t = setup();
    t.gh.code = 1;
    await t.poll();
    t.gh.code = 0;
    expect(await t.poll()).toMatchObject({ ok: true });
  });

  it("refuses to poll while another poll holds the lock, calling no gh", async () => {
    const t = setup();
    await t.fs.createFile(`${PATH}.lock`, "2026-02-01T00:00:00.000Z");
    const result = await t.poll();
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("Another poll");
    expect(t.runner.calls).toHaveLength(0);
  });
});

describe("pollGithub ids, late merges and paging", () => {
  it("gives each event a deterministic id from GitHub's own numbers", async () => {
    const t = setup();
    t.gh.issues = [issue(7, "2026-01-05T10:00:00Z")];
    t.gh.prs = [pr(9, "2026-01-06T10:00:00Z", "2026-01-06T12:00:00Z")];
    t.gh.events = [[labelled(11, 7, "2026-01-05T11:00:00Z", "bug")]];
    await t.poll();
    expect((await t.stored()).map((e) => e.id).sort()).toEqual([
      "github:issue.labelled:11",
      "github:issue.opened:7",
      "github:pr.merged:9",
      "github:pr.opened:9",
    ]);
  });

  it("records a merge after the default since for a PR opened before it", async () => {
    const t = setup();
    t.gh.issues = [issue(1, "2026-01-08T10:00:00Z")];
    await t.poll();
    t.gh.prs = [pr(9, "2026-01-06T10:00:00Z", "2026-01-09T12:00:00Z")];
    await t.poll();
    expect(await t.summary()).toEqual([
      "issue.opened:1",
      "pr.opened:9",
      "pr.merged:9",
    ]);
  });

  it("reads label events from every full page until a short one", async () => {
    const t = setup();
    t.gh.events = [
      fullPage(1, "2026-01-09"),
      [labelled(500, 8, "2026-01-08T12:00:00Z", "b")],
    ];
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 101 });
    expect(t.calls().filter((c) => c.includes("page="))).toHaveLength(2);
  });

  it("stops paging at the first page older than since, without --paginate", async () => {
    const t = setup();
    t.gh.events = [
      fullPage(1, "2026-01-09"),
      fullPage(1001, "2026-01-01"),
      fullPage(2001, "2025-12-01"),
    ];
    await t.poll("2026-01-05T00:00:00Z");
    const pages = t.calls().filter((c) => c.includes("page="));
    expect(pages).toHaveLength(2);
    expect(t.calls().join("\n")).not.toContain("--paginate");
  });

  it("fails loudly instead of silently dropping issues past gh's limit", async () => {
    const t = setup();
    t.gh.issues = Array.from({ length: 1000 }, (_, i) =>
      issue(i + 1, "2026-01-05T10:00:00Z"),
    );
    const result = await t.poll();
    expect(result).toMatchObject({ ok: false });
    expect(t.fs.files.has(PATH)).toBe(false);
  });
});

describe("pollGithub rate limits, lock and response shape", () => {
  it("names a rate limit and when to retry, from gh api rate_limit", async () => {
    const t = setup();
    t.gh.code = 1;
    t.gh.stderr = "gh: API rate limit exceeded for user (HTTP 403)";
    t.gh.rateLimit = JSON.stringify({
      resources: { core: { reset: Date.UTC(2026, 1, 1, 1) / 1000 } },
    });
    const result = await t.poll();
    expect(result).toMatchObject({ ok: false });
    const { message } = result as { message: string };
    expect(message).toContain("rate limit");
    expect(message).toContain("2026-02-01T01:00:00.000Z");
    expect(message).not.toContain("gh auth status");
  });

  it("treats HTTP 429 as a rate limit even when the reset time is unavailable", async () => {
    const t = setup();
    t.gh.code = 1;
    t.gh.stderr = "HTTP 429: Too Many Requests";
    const { message } = (await t.poll()) as { message: string };
    expect(message).toContain("rate limit");
    expect(message).toContain("few minutes");
  });

  it("keeps the lock fresh across slow gh calls so no one takes it over", async () => {
    const t = setup();
    const seen: number[] = [];
    t.gh.onCall = () => {
      t.advance(40_000);
      seen.push(Date.parse(t.fs.files.get(`${PATH}.lock`) ?? ""));
    };
    expect(await t.poll()).toMatchObject({ ok: true });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    seen.slice(1).forEach((time, i) => {
      expect(time - (seen[i] ?? 0)).toBeGreaterThanOrEqual(40_000);
    });
  });

  it("rejects gh api output that is not a list of event objects", async () => {
    const t = setup();
    t.gh.events = [[[labelled(1, 7, "2026-01-05T11:00:00Z", "a")]]];
    const result = await t.poll();
    expect(result).toMatchObject({ ok: false });
    expect(t.fs.files.has(PATH)).toBe(false);
  });

  it("rejects gh api output that is not a list", async () => {
    const t = setup();
    t.gh.events = [{ message: "Not Found" }];
    expect(await t.poll()).toMatchObject({ ok: false });
  });
});
