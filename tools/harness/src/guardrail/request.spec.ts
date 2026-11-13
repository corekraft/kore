// `harness guardrail request`: asks a person to approve a guardrail mode
// change on the idea's issue, with the outcome evidence, and records it.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { ghWrites } from "../outcome/outcome-support.js";
import { INVENTORY_PATH } from "./index.js";
import {
  INVENTORY,
  ledgerEvents,
  ready,
  request,
  withGit,
  withRulesetInsights,
} from "./request-support.js";
import { inventoryOf } from "./history-support.js";

describe("guardrail request comment for an audit rule", () => {
  it("comments on the idea's issue with the idea link and figures that add up to fired", async () => {
    const { h, issue } = await ready();
    expect(await request(h, "image-digest", "enforce")).toBe(0);
    expect(issue.comments).toHaveLength(1);
    const body = issue.comments[0] ?? "";
    expect(body).toContain("https://github.com/corekraft/kore/issues/300");
    expect(body).toContain("Idea 0001");
    expect(body).toContain(
      "| Fired | Heeded | Overridden | Repeated (identical call) | Unresolved |\n| --- | --- | --- | --- | --- |\n| 5 | 4 | 1 | 0 | 0 |",
    );
    expect(body).toContain("audit → enforce");
  });

  it("leaves whether a warning was a false positive to the approving person", async () => {
    const { h, issue } = await ready();
    await request(h, "image-digest", "enforce");
    const body = issue.comments[0] ?? "";
    expect(body).toMatch(
      /- \[ \] I judged whether the firings above hit legitimate work/,
    );
    expect(body).toContain("a person's judgement");
    expect(body).not.toMatch(/did not apply/);
    expect(body).not.toMatch(/\| False positives/);
  });

  it("takes its evidence from the retro-scan classification of the same transcripts", async () => {
    const { h, issue } = await ready();
    expect(
      await run(["hook", "retro-scan", "--dir", "/repo/transcripts"], h.deps),
    ).toBe(0);
    const report = JSON.parse(h.out().slice(h.out().indexOf("{"))) as {
      rules: { audit: { rule: string; status: string }[] };
    };
    const classes = Object.fromEntries(
      report.rules.audit.map((r) => [r.rule, r.status]),
    );
    expect(new Set(Object.values(classes)).size).toBeGreaterThan(1);
    for (const rule of ["image-digest", "sample-audit", "unquoted-glob"]) {
      issue.comments.length = 0;
      expect(await request(h, rule, "enforce", ["--since", "2026-01-01"])).toBe(
        0,
      );
      expect(issue.comments[0]).toContain(`Classification: ${classes[rule]}`);
    }
  });
});

describe("guardrail request evidence by kind", () => {
  it("reports an enforced hook rule's blocks", async () => {
    const { h, issue } = await ready();
    expect(await request(h, "kubectl-context", "audit")).toBe(0);
    expect(issue.comments[0]).toContain("| Blocked |\n| --- |\n| 1 |");
    expect(issue.comments[0]).toContain("Loosening");
  });

  it.each([
    ["enforced-rule", "remove", "enforce → removed"],
    ["unquoted-glob", "enforce", "audit → enforce"],
  ])(
    "requests %s to %s the same way, naming the change",
    async (rule, to, change) => {
      const { h, issue } = await ready();
      expect(await request(h, rule, to)).toBe(0);
      expect(issue.comments[0]).toContain(change);
      expect(ledgerEvents(h)[0]).toMatchObject({ label: `${rule}:${to}` });
    },
  );

  it("reads a ruleset rule's firings from the candidate ruleset's insights", async () => {
    const { h, issue } = await ready();
    const where = withRulesetInsights(h);
    expect(
      await request(h, "main-ruleset-pull-request", "enforce", where),
    ).toBe(0);
    expect(issue.comments[0]).toContain(
      "| Suites evaluated | Would have blocked |\n| --- | --- |\n| 2 | 1 |",
    );
    expect(issue.comments[0]).toContain("harness ruleset insights");
  });

  it("asks a ruleset rule's request to name its repository and ruleset", async () => {
    const { h, issue } = await ready();
    expect(await request(h, "main-ruleset-pull-request", "enforce")).toBe(1);
    expect(h.err()).toMatch(/Missing --repo/);
    expect(issue.comments).toHaveLength(0);
    expect(ledgerEvents(h)).toHaveLength(0);
  });

  it.each([
    [
      "main-ruleset-deletion",
      "audit",
      /ruleset insights.*candidate ruleset.*audit/s,
    ],
    [
      "deny-iac-destroy",
      "audit",
      /deny rule.*nothing counts its blocks.*audit/s,
    ],
  ])(
    "refuses %s, which nothing measures, naming what to use instead",
    async (rule, to, why) => {
      const { h, issue } = await ready();
      expect(await request(h, rule, to)).toBe(1);
      expect(h.err()).toMatch(why);
      expect(issue.comments).toHaveLength(0);
      expect(ledgerEvents(h)).toHaveLength(0);
    },
  );
});

describe("guardrail request evidence window", () => {
  it("opens when the rule entered its current mode, from the inventory's git history", async () => {
    const { h, issue } = await ready();
    withGit(h, [
      {
        sha: "c1",
        date: "2026-01-02T00:00:00Z",
        text: inventoryOf({ "image-digest": "audit" }),
      },
    ]);
    await request(h, "image-digest", "enforce");
    expect(issue.comments[0]).toContain(
      "since 2026-01-02, when the rule entered audit mode",
    );
    expect(issue.comments[0]).toContain("| 5 | 4 | 1 | 0 | 0 |");
  });

  it("counts only sessions after a later start, so an old rule's evidence is not mixed with a new mode's", async () => {
    const { h, issue } = await ready();
    withGit(h, [
      {
        sha: "c1",
        date: "2099-01-01T00:00:00Z",
        text: inventoryOf({ "image-digest": "audit" }),
      },
    ]);
    await request(h, "image-digest", "enforce");
    expect(issue.comments[0]).toContain("since 2099-01-01");
    expect(issue.comments[0]).toContain("| 0 | 0 | 0 | 0 | 0 |");
    expect(issue.comments[0]).toContain(
      "Classification: insufficient-evidence",
    );
  });

  it("takes --since over the git history", async () => {
    const { h, issue } = await ready();
    withGit(h, [
      {
        sha: "c1",
        date: "2099-01-01T00:00:00Z",
        text: inventoryOf({ "image-digest": "audit" }),
      },
    ]);
    await request(h, "image-digest", "enforce", ["--since", "2026-01-01"]);
    expect(issue.comments[0]).toContain("since 2026-01-01, from --since");
    expect(issue.comments[0]).toContain("| 5 | 4 | 1 | 0 | 0 |");
  });
});

describe("guardrail request effects", () => {
  it("records one ledger event for the request, with an id the comment carries", async () => {
    const { h, issue } = await ready();
    await request(h, "image-digest", "enforce");
    expect(ledgerEvents(h)).toMatchObject([
      {
        id: "req-1",
        kind: "guardrail.request",
        idea: "0001",
        label: "image-digest:enforce",
      },
    ]);
    expect(issue.comments[0]).toContain("<!-- guardrail-request: req-1 -->");
  });

  it("never changes the inventory, the settings or the ruleset", async () => {
    const { h } = await ready();
    const before = h.snapshot();
    await request(h, "image-digest", "enforce");
    const after = h.snapshot();
    expect(after[INVENTORY_PATH]).toBe(INVENTORY);
    for (const [path, text] of Object.entries(before)) {
      expect(after[path]).toBe(text);
    }
    const gh = h.runner.calls.filter((c) => c.command === "gh");
    expect(gh.some((c) => c.args[0] === "api")).toBe(false);
    expect(ghWrites(h).map((c) => c.args[1])).toEqual(["comment"]);
  });

  it("says so instead of posting again while the same request still waits", async () => {
    const { h, issue } = await ready();
    await request(h, "image-digest", "enforce");
    expect(await request(h, "image-digest", "enforce")).toBe(0);
    expect(h.out()).toContain('"commented":false,"recorded":false');
    expect(issue.comments).toHaveLength(1);
    expect(ledgerEvents(h)).toHaveLength(1);
  });

  it("finishes a request that was recorded but not posted, with the same request", async () => {
    const { h, issue } = await ready();
    await request(h, "image-digest", "enforce");
    issue.comments.length = 0;
    expect(await request(h, "image-digest", "enforce")).toBe(0);
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0]).toContain("req-1");
    expect(ledgerEvents(h)).toHaveLength(1);
  });
});

describe("guardrail request refusals", () => {
  it.each([
    ["no-such-rule", "enforce", /no-such-rule.*not in .*guardrails\.yaml/s],
    ["image-digest", "audit", /already in audit/],
    ["image-digest", "sideways", /--to must be enforce, audit or remove/],
  ])(
    "refuses %s to %s with the fix and posts nothing",
    async (rule, to, why) => {
      const { h, issue } = await ready();
      expect(await request(h, rule, to)).toBe(1);
      expect(h.err()).toMatch(why);
      expect(issue.comments).toHaveLength(0);
      expect(ledgerEvents(h)).toHaveLength(0);
    },
  );

  it("refuses an idea with no issue, naming the sync that fixes it", async () => {
    const { h } = await ready();
    const path = "docs/ideas/0001-cache-the-probe-results.md";
    h.set(
      path,
      (h.get(path) ?? "")
        .split("\n")
        .filter((l) => !l.startsWith("issue:"))
        .join("\n"),
    );
    expect(await request(h, "image-digest", "enforce")).toBe(1);
    expect(h.err()).toMatch(/harness idea sync/);
  });

  it("fails with the fix, recording nothing, when no transcripts can be read", async () => {
    const { h, issue } = await ready();
    expect(
      await request(h, "image-digest", "enforce", ["--dir", "/nowhere"]),
    ).toBe(1);
    expect(h.err()).toMatch(/--dir/);
    expect(issue.comments).toHaveLength(0);
    expect(ledgerEvents(h)).toHaveLength(0);
  });
});
