import { describe, expect, it } from "vitest";
import {
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
    t.gh.events = [labelled(11, 7, "2026-01-05T11:00:00Z", "ready-for-agent")];
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
    t.gh.events = [labelled(11, 7, "2026-01-05T11:00:00Z", "bug")];
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

  it("defaults --since to the latest recorded GitHub event", async () => {
    const t = setup();
    t.gh.issues = [issue(1, "2026-01-05T10:00:00Z")];
    await t.poll();
    t.gh.issues = [
      issue(1, "2026-01-05T10:00:00Z"),
      issue(2, "2026-01-04T10:00:00Z"),
      issue(3, "2026-01-07T10:00:00Z"),
    ];
    await t.poll();
    expect(await t.summary()).toEqual(["issue.opened:1", "issue.opened:3"]);
  });

  it("honours an explicit --since over the ledger", async () => {
    const t = setup();
    t.gh.issues = [
      issue(1, "2026-01-05T10:00:00Z"),
      issue(2, "2026-01-08T10:00:00Z"),
    ];
    await t.poll("2026-01-06T00:00:00Z");
    expect(await t.summary()).toEqual(["issue.opened:2"]);
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
    t.gh.events = [labelled(11, 7, "2026-01-05T11:00:00Z", "bug")];
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
});
