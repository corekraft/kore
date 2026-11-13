import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import {
  LEDGER,
  REVIEWER,
  kore,
  passing,
  precheck,
  report,
  scenario,
  type Harness,
} from "./judge-support.js";

const INVENTORY = "/repo/.claude/guardrails.yaml";

const withModes = (h: Harness, modes: Record<string, string>): void => {
  h.files.set(
    INVENTORY,
    JSON.stringify({
      guardrails: Object.entries(modes).map(([rule, mode]) => ({
        rule,
        kind: "judge",
        mode,
        owner: "tools/harness/src/judge/items.ts",
      })),
    }),
  );
};

const scanFails = [passing[0], { ...passing[1], conclusion: "FAILURE" }];

const events = (h: Harness, kind: string) =>
  (h.files.get(LEDGER) ?? "")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e["kind"] === kind);

describe("judge checklist audit mode", () => {
  it("reports a failing audit item without sending the change back", async () => {
    const h = scenario({ rollup: scanFails });
    withModes(h, { "judge-scan": "audit" });
    expect(await precheck(h)).toBe(0);
    expect(report(h)).toMatchObject({
      ok: true,
      audited: [{ rule: "judge-scan", result: "fail" }],
    });
  });

  it("sends the same failing item back when it is in enforce mode", async () => {
    const h = scenario({ rollup: scanFails });
    withModes(h, { "judge-scan": "enforce" });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({ ok: false, audited: [] });
  });

  it("writes a ledger event for every audit firing", async () => {
    const h = scenario({ rollup: scanFails });
    withModes(h, { "judge-scan": "audit" });
    await precheck(h);
    await precheck(h);
    expect(events(h, "guard.audit").map((e) => e["label"])).toEqual([
      "judge-scan",
      "judge-scan",
    ]);
  });

  it("writes no audit event when an audit item passes", async () => {
    const h = scenario();
    withModes(h, { "judge-scan": "audit", "judge-ci": "audit" });
    await precheck(h);
    expect(events(h, "guard.audit")).toEqual([]);
  });

  it("keeps every item enforcing when the inventory lists none of them", async () => {
    const h = scenario({ rollup: scanFails });
    withModes(h, { "secret-path": "audit" });
    expect(await precheck(h)).toBe(1);
  });

  it("audits a pattern the diff contradicts and still fails the other items", async () => {
    const h = scenario({ diff: kore, rollup: scanFails });
    withModes(h, {
      "judge-pattern-match": "audit",
      "judge-scan": "enforce",
    });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({
      audited: [{ rule: "judge-pattern-match" }],
    });
  });

  it("audits a missing principles-review", async () => {
    const h = scenario({ comments: [] });
    withModes(h, { "judge-principles-review": "audit" });
    expect(await precheck(h)).toBe(0);
    expect(report(h)).toMatchObject({
      audited: [{ rule: "judge-principles-review", result: "missing" }],
    });
  });

  it("merges when the only failing item is audited", async () => {
    const h = scenario({ rollup: scanFails });
    withModes(h, { "judge-scan": "audit" });
    expect(
      await run(
        ["judge", "merge", "42", "--json", "--reviewer", REVIEWER],
        h.deps,
      ),
    ).toBe(0);
    expect(events(h, "guard.audit")).toHaveLength(1);
  });
});

describe("judge checklist audit mode inventory and merge", () => {
  it("enforces every item when the inventory file is missing", async () => {
    const h = scenario({ rollup: scanFails });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({ ok: false, audited: [] });
  });

  it("refuses to judge against a malformed inventory and merges nothing", async () => {
    const h = scenario();
    h.files.set(INVENTORY, "not json");
    expect(await precheck(h)).toBe(1);
    expect(h.err()).toContain("guardrails.yaml");
    expect(h.err()).toContain("fix it there");
  });
});
