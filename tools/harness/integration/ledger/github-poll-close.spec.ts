import { describe, expect, it } from "vitest";
import { issue, pr, setup } from "./github-poll-support.js";

describe("pollGithub closes and PR attribution", () => {
  it("records a closed issue at GitHub's closing time, once", async () => {
    const t = setup();
    t.gh.issues = [issue(7, "2026-01-05T10:00:00Z", "2026-01-06T12:00:00Z")];
    await t.poll();
    await t.poll("2026-01-01T00:00:00Z");
    expect(await t.summary()).toEqual(["issue.opened:7", "issue.closed:7"]);
    expect((await t.stored())[1]).toMatchObject({
      id: "github:issue.closed:7",
      occurredAt: "2026-01-06T12:00:00Z",
    });
  });

  it("records no close for an issue that is still open", async () => {
    const t = setup();
    t.gh.issues = [issue(7, "2026-01-05T10:00:00Z")];
    await t.poll();
    expect(await t.summary()).toEqual(["issue.opened:7"]);
  });

  it("finds issues closed since the last poll even when opened earlier", async () => {
    const t = setup();
    await t.poll("2026-01-05T10:00:00Z");
    expect(t.calls().find((c) => c.startsWith("issue list"))).toContain(
      "updated:>=2026-01-05",
    );
  });

  it("attributes a PR's events to the issue it closes", async () => {
    const t = setup();
    t.gh.prs = [
      pr(300, "2026-01-05T10:00:00Z", "2026-01-05T12:00:00Z", [7]),
      pr(301, "2026-01-05T10:00:00Z"),
    ];
    await t.poll();
    const events = await t.stored();
    expect(
      events.map((e) => `${e.kind}:${e.number}:${e.idea ?? "-"}`).sort(),
    ).toEqual(["pr.merged:300:#7", "pr.opened:300:#7", "pr.opened:301:-"]);
  });
});
