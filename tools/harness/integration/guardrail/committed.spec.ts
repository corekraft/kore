// The committed guardrail files: the inventory, the settings deny list and the
// guard source, read from the repository. Real files together, so an integration
// spec rather than a unit (moved from the unit specs, not deleted).
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INVENTORY_PATH,
  auditRuleNames,
  denyList,
  parseInventory,
} from "../../src/guardrail/index.js";
import { committedInventory } from "../../src/testing/index.js";

const repo = new URL("../../../../", import.meta.url).pathname;

// Today's deny list, written out so a regeneration cannot quietly change it.
const TODAY = [
  "Bash(k3d cluster delete:*)",
  "Bash(k3d * cluster delete*)",
  "Bash(k3d cluster * delete*)",
  "Bash(tofu destroy:*)",
  "Bash(terraform destroy:*)",
  "Bash(helm uninstall:*)",
  "Bash(kubectl delete namespace:*)",
  "Bash(kubectl delete ns:*)",
  "Bash(kore * destroy)",
  "Bash(kore * destroy *)",
  "Bash(./bin/kore * destroy)",
  "Bash(./bin/kore * destroy *)",
  "Read(./.kore/keys/**)",
  "Read(./.kore/state/*token*)",
];

describe("the committed deny list", () => {
  it("equals today's list, and the committed settings deny it exactly", () => {
    expect(denyList(committedInventory)).toEqual(TODAY);
    const settings = JSON.parse(
      readFileSync(`${repo}.claude/settings.json`, "utf8"),
    );
    expect(settings.permissions.deny).toEqual(TODAY);
  });

  it("holds only rules in enforce mode", () => {
    expect(
      committedInventory.guardrails
        .filter((g) => g.deny !== undefined)
        .every((g) => g.mode === "enforce"),
    ).toBe(true);
  });

  it("names the module that generates them as their owner, and it exists", () => {
    for (const g of committedInventory.guardrails.filter((r) => r.deny)) {
      expect(g.owner).toBe("tools/harness/src/guardrail/deny.ts");
      expect(existsSync(`${repo}${g.owner}`)).toBe(true);
    }
  });
});

describe("the committed inventory", () => {
  const inventory = parseInventory(
    readFileSync(join(repo, INVENTORY_PATH), "utf8"),
  );

  it("lists exactly the rules the guard source names", () => {
    const dir = join(repo, "tools/harness/src/hook");
    const source = readdirSync(dir)
      .filter((name) => /^guard(-[a-z-]+)?\.ts$/.test(name))
      .filter((name) => !/-(support|verdict)\.ts$/.test(name))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n");
    const named = [
      ...source.matchAll(/\b(?:block|warn)\(\s*"([a-z0-9-]+)"/g),
    ].map((m) => m[1] ?? "");
    const byName = (a: string, b: string) => a.localeCompare(b);
    // A deny rule's code is a Claude Code permission rule or the guard's generic matcher, and the
    // ruleset's is `harness ruleset sync`; neither is a block() call.
    const coded = inventory.guardrails.filter(
      (g) => g.deny === undefined && g.kind !== "ruleset",
    );
    expect(coded.map((g) => g.rule).sort(byName)).toEqual(
      [...new Set(named)].sort(byName),
    );
  });

  it("keeps today's warn rules in audit and the rest enforced", () => {
    expect(auditRuleNames(inventory)).toEqual([
      "append-only",
      "bare-glob",
      "flag-activation",
      "guardrail-demotion",
      "idea-issue-body",
      "idea-issue-close",
      "idea-outcome",
      "image-digest",
    ]);
  });
});
