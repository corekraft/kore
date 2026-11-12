import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { DEFAULT, harness } from "./ledger-commands-support.js";
import { ideaText } from "../testing/records-support.js";

const PLAN =
  "---\nstatus: active\nsummary: s\nlast-verified: 2026-11-11\n---\n\n## Step 1: A\n\n- [ ] x\n- [x] y\n- [ ] z\n";

const event = (kind: string, at: string, extra: object = {}) =>
  JSON.stringify({
    schema: 1,
    id: `${kind}-${at}`,
    source: "github",
    kind,
    occurredAt: at,
    recordedAt: at,
    ...extra,
  });

function seeded(ledger = "") {
  const h = harness();
  h.fs.files.set("/repo/infra/plans/5-a.md", PLAN);
  // The in-memory file system only knows a directory by a file of that name.
  h.fs.files.set("/repo/docs/ideas", "");
  h.fs.files.set("/repo/docs/ideas/0001-open-one.md", ideaText({}, "Open one"));
  h.fs.files.set(
    "/repo/docs/ideas/0002-won.md",
    ideaText({ outcome: "success" }, "Won"),
  );
  h.fs.files.set(
    "/repo/docs/ideas/0003-lost.md",
    ideaText({ outcome: "failure" }, "Lost"),
  );
  if (ledger !== "") {
    h.fs.files.set(DEFAULT, ledger);
  }
  return h;
}

describe("harness status", () => {
  it("--json reports open plan items, ideas by state and recent ledger stages", async () => {
    const h = seeded(
      [
        event("issue.opened", "2026-01-01T00:00:00Z", { number: 7 }),
        event("pr.opened", "2026-01-02T00:00:00Z", { number: 8 }),
        event("pane.busy", "2026-01-03T00:00:00Z", { pane: "p1" }),
        event("outcome", "2026-01-04T00:00:00Z", {
          number: 7,
          label: "success",
        }),
      ].join("\n") + "\n",
    );
    expect(await run(["status", "--json"], h.deps)).toBe(0);
    const status = JSON.parse(h.out());
    expect(status.plans).toEqual([
      expect.objectContaining({
        name: "5-a.md",
        open: [{ step: "Step 1", count: 2 }],
      }),
    ]);
    expect(status.ideas.byState).toEqual({ open: 1, success: 1, failure: 1 });
    expect(status.ideas.items).toEqual([
      { number: "0001", title: "Open one", state: "open" },
      { number: "0002", title: "Won", state: "success" },
      { number: "0003", title: "Lost", state: "failure" },
    ]);
    expect(status.ledger.recent).toEqual([
      {
        occurredAt: "2026-01-04T00:00:00Z",
        stage: "outcome",
        kind: "outcome",
        number: 7,
      },
      {
        occurredAt: "2026-01-02T00:00:00Z",
        stage: "merge",
        kind: "pr.opened",
        number: 8,
      },
      {
        occurredAt: "2026-01-01T00:00:00Z",
        stage: "await approval",
        kind: "issue.opened",
        number: 7,
      },
    ]);
  });
});

describe("harness status output", () => {
  it("limits recent ledger stages to the latest ten, newest first", async () => {
    const lines = Array.from({ length: 12 }, (_, i) =>
      event(
        "pr.opened",
        `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        {
          number: i + 1,
        },
      ),
    );
    const h = seeded(`${lines.join("\n")}\n`);
    await run(["status", "--json"], h.deps);
    const recent = JSON.parse(h.out()).ledger.recent;
    expect(recent).toHaveLength(10);
    expect(recent[0].number).toBe(12);
  });

  it("reports empty sections when there is no plan, idea or ledger", async () => {
    const h = harness();
    expect(await run(["status", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      plans: [],
      ideas: { byState: {}, items: [] },
      ledger: { recent: [], skipped: 0 },
    });
  });

  it("prints a readable summary without --json", async () => {
    const h = seeded(
      event("pr.opened", "2026-01-02T00:00:00Z", { number: 8 }) + "\n",
    );
    expect(await run(["status"], h.deps)).toBe(0);
    expect(h.out()).toContain("infra/plans/5-a.md");
    expect(h.out()).toContain("Ideas: 1 open, 1 success, 1 failure");
    expect(h.out()).toContain("merge pr.opened");
  });

  it("never writes a file", async () => {
    const h = seeded();
    const before = JSON.stringify([...h.fs.files]);
    await run(["status", "--json"], h.deps);
    expect(JSON.stringify([...h.fs.files])).toBe(before);
  });

  it("ignores a stage an agent reports about itself", async () => {
    const h = seeded(
      [
        event("session.start", "2026-01-05T00:00:00Z", {
          source: "claude",
          stage: "merge",
        }),
        event("pr.opened", "2026-01-02T00:00:00Z", {
          source: "claude",
          number: 9,
        }),
        event("pr.opened", "2026-01-01T00:00:00Z", { number: 8 }),
      ].join("\n") + "\n",
    );
    await run(["status", "--json"], h.deps);
    expect(JSON.parse(h.out()).ledger.recent).toEqual([
      expect.objectContaining({ kind: "pr.opened", number: 8 }),
    ]);
  });
});
