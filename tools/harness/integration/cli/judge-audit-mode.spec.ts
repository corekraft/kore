import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INVENTORY,
  LEDGER,
  inventoryWith,
  passing,
  precheck,
  report,
  scenario,
  verbs,
} from "./judge-support.js";

const failingScan = [passing[0], { ...passing[1], conclusion: "FAILURE" }];
const audits = (ledger: string | undefined) =>
  (ledger ?? "")
    .split("\n")
    .filter((l) => l.includes('"kind":"guard.audit"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("judge checklist audit mode", () => {
  it("reports a failing audit item without sending the change back, and writes one ledger event", async () => {
    const h = scenario({
      rollup: failingScan,
      files: { [INVENTORY]: inventoryWith({ scan: "audit" }) },
    });
    expect(await precheck(h)).toBe(0);
    expect(report(h)).toMatchObject({
      ok: true,
      audited: [{ item: "scan", rule: "judge-scan", mode: "audit" }],
    });
    expect(audits(h.files.get(LEDGER))).toMatchObject([
      { label: "judge-scan", source: "github" },
    ]);
  });

  it("sends the change back for the same item in enforce mode, and writes no audit event", async () => {
    const h = scenario({ rollup: failingScan });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({ ok: false, audited: [] });
    expect(audits(h.files.get(LEDGER))).toEqual([]);
  });

  it("writes the firing once when the precheck is rerun at the same head", async () => {
    const h = scenario({
      rollup: failingScan,
      files: { [INVENTORY]: inventoryWith({ scan: "audit" }) },
    });
    await precheck(h);
    const first = h.out().length;
    await precheck(h);
    expect(h.out().length).toBeGreaterThan(first);
    expect(audits(h.files.get(LEDGER))).toHaveLength(1);
  });

  it("refuses a mode that is neither audit nor enforce, naming the fix, before it reads the PR", async () => {
    const h = scenario({
      files: { [INVENTORY]: inventoryWith({ scan: "warn" }) },
    });
    expect(await precheck(h)).toBe(1);
    expect(h.err()).toContain("guardrails[1].mode must be audit or enforce");
    expect(h.err()).toContain("fix it, then rerun");
    expect(verbs(h)).toEqual([]);
  });

  it("keeps every checklist item of the repository's own inventory in enforce", () => {
    const text = readFileSync(
      new URL("../../../../.claude/guardrails.yaml", import.meta.url),
      "utf8",
    );
    const items = (
      JSON.parse(text) as { guardrails: { rule: string; mode: string }[] }
    ).guardrails.filter((g) => g.rule.startsWith("judge-"));
    expect(items.map((g) => g.rule)).toEqual([
      "judge-ci",
      "judge-scan",
      "judge-coverage",
      "judge-principles-review",
      "judge-expand-step",
      "judge-pattern-match",
    ]);
    expect(items.map((g) => g.mode)).toEqual(items.map(() => "enforce"));
  });
});
