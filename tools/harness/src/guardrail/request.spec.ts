// `harness guardrail request`: asks a person to approve a guardrail mode
// change on the idea's issue, with the outcome evidence, and records it.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { ghWrites } from "../outcome/outcome-support.js";
import { INVENTORY_PATH } from "./index.js";
import { INVENTORY, ledgerEvents, ready, request } from "./request-support.js";

describe("guardrail request comment", () => {
  it("comments on the idea's issue with the idea link and the four figures", async () => {
    const { h, issue } = await ready();
    expect(await request(h, "image-digest", "enforce")).toBe(0);
    expect(issue.comments).toHaveLength(1);
    const body = issue.comments[0] ?? "";
    expect(body).toContain("https://github.com/corekraft/kore/issues/300");
    expect(body).toContain("Idea 0001");
    expect(body).toContain(
      "| Fired | Heeded | Overridden | False positives |\n| --- | --- | --- | --- |\n| 5 | 4 | 1 | 0 |",
    );
    expect(body).toContain("audit → enforce");
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
      expect(await request(h, rule, "enforce")).toBe(0);
      expect(issue.comments[0]).toContain(`Classification: ${classes[rule]}`);
    }
  });

  it.each([
    ["enforced-rule", "audit", "enforce → audit", "Loosening"],
    ["enforced-rule", "remove", "enforce → removed", "Loosening"],
    ["unquoted-glob", "enforce", "audit → enforce", "Tightening"],
  ])(
    "requests %s to %s the same way, naming the direction",
    async (rule, to, change, direction) => {
      const { h, issue } = await ready();
      expect(await request(h, rule, to)).toBe(0);
      expect(issue.comments[0]).toContain(change);
      expect(issue.comments[0]).toContain(direction);
      expect(ledgerEvents(h)[0]).toMatchObject({ label: `${rule}:${to}` });
    },
  );
});

describe("guardrail request effects", () => {
  it("records one ledger event for the request", async () => {
    const { h } = await ready();
    await request(h, "image-digest", "enforce");
    expect(ledgerEvents(h)).toMatchObject([
      {
        kind: "guardrail.request",
        idea: "0001",
        label: "image-digest:enforce",
      },
    ]);
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

  it("does not post twice when the same request is repeated", async () => {
    const { h, issue } = await ready();
    await request(h, "image-digest", "enforce");
    await request(h, "image-digest", "enforce");
    expect(issue.comments).toHaveLength(1);
    expect(ledgerEvents(h)).toHaveLength(1);
  });
});

describe("guardrail request after the first", () => {
  it("says so instead of posting again while the same request still waits", async () => {
    const { h, issue } = await ready();
    await request(h, "image-digest", "enforce");
    expect(await request(h, "image-digest", "enforce")).toBe(0);
    expect(h.out()).toContain('"commented":false,"recorded":false');
    expect(issue.comments).toHaveLength(1);
  });

  it("finishes a request whose comment posted but whose ledger event did not", async () => {
    const { h, issue } = await ready();
    issue.comments.push("<!-- guardrail-request: image-digest:enforce -->");
    expect(await request(h, "image-digest", "enforce")).toBe(0);
    expect(issue.comments).toHaveLength(1);
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

  it("fails with the fix when no transcripts can be read", async () => {
    const { h, issue } = await ready();
    expect(
      await request(h, "image-digest", "enforce", ["--dir", "/nowhere"]),
    ).toBe(1);
    expect(h.err()).toMatch(/--dir/);
    expect(issue.comments).toHaveLength(0);
  });
});
