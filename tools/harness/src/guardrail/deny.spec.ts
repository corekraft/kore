import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GuardrailError, parseInventory } from "./inventory.js";
import { denyDrift, denyList, denyMatches, settingsWithDeny } from "./deny.js";
import { committedInventory } from "../testing/guardrail-support.js";

const repo = new URL("../../../../", import.meta.url).pathname;
const rule = (over: Record<string, unknown> = {}) => ({
  rule: "deny-x",
  kind: "bash",
  mode: "enforce",
  owner: ".claude/settings.json",
  deny: ["Bash(x:*)"],
  ...over,
});
const inventory = (...rules: unknown[]) =>
  parseInventory(JSON.stringify({ guardrails: rules }));

// Today's deny list, written out so a regeneration cannot quietly change it.
const TODAY = [
  "Bash(minikube delete:*)",
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

describe("the generated deny list", () => {
  it("holds only rules in enforce mode", () => {
    const inv = inventory(
      rule(),
      rule({ rule: "deny-y", mode: "audit", deny: ["Bash(y:*)"] }),
    );
    expect(denyList(inv)).toEqual(["Bash(x:*)"]);
  });

  it("equals today's list, and the committed settings deny it exactly", () => {
    expect(denyList(committedInventory)).toEqual(TODAY);
    const settings = JSON.parse(
      readFileSync(`${repo}.claude/settings.json`, "utf8"),
    );
    expect(settings.permissions.deny).toEqual(TODAY);
    expect(
      committedInventory.guardrails
        .filter((g) => g.deny !== undefined)
        .every((g) => g.mode === "enforce"),
    ).toBe(true);
  });

  it("is rewritten into settings without touching any other key", () => {
    const before = JSON.stringify({
      permissions: { allow: ["Bash(ls)"], deny: ["Bash(old:*)"] },
      hooks: {},
    });
    const after = JSON.parse(settingsWithDeny(before, ["Bash(x:*)"]));
    expect(after).toEqual({
      permissions: { allow: ["Bash(ls)"], deny: ["Bash(x:*)"] },
      hooks: {},
    });
  });
});

describe("deny rules in the inventory", () => {
  it.each([
    ["an empty deny list", rule({ deny: [] }), /deny/],
    ["a pattern that is not a permission rule", rule({ deny: ["x"] }), /deny/],
    ["a Bash pattern on a file rule", rule({ kind: "file" }), /kind/],
    ["a Read pattern on a bash rule", rule({ deny: ["Read(a)"] }), /kind/],
  ])("rejects %s", (_, bad, message) => {
    expect(() => inventory(bad)).toThrow(GuardrailError);
    expect(() => inventory(bad)).toThrow(message);
  });
});

describe("hand-editing the generated list", () => {
  const inv = inventory(rule());
  const settings = (deny: string[]) =>
    JSON.stringify({ permissions: { deny } });

  it("is clean when settings match the inventory", () => {
    expect(denyDrift(inv, settings(["Bash(x:*)"]))).toEqual([]);
  });

  it("names a rule added by hand", () => {
    expect(denyDrift(inv, settings(["Bash(x:*)", "Bash(z:*)"]))).toEqual([
      expect.stringMatching(/Bash\(z:\*\).*not generated/),
    ]);
  });

  it("names a rule removed by hand", () => {
    expect(denyDrift(inv, settings([]))).toEqual([
      expect.stringMatching(/Bash\(x:\*\).*missing/),
    ]);
  });

  it("names a reordered list", () => {
    const two = inventory(rule({ deny: ["Bash(x:*)", "Bash(y:*)"] }));
    expect(denyDrift(two, settings(["Bash(y:*)", "Bash(x:*)"]))).toEqual([
      expect.stringMatching(/order/),
    ]);
  });
});

describe("matching a deny pattern", () => {
  it.each([
    ["Bash(minikube delete:*)", "Bash", "minikube delete", true],
    ["Bash(minikube delete:*)", "Bash", "minikube delete -p x", true],
    ["Bash(minikube delete:*)", "Bash", "minikube deletex", false],
    ["Bash(k3d * cluster delete*)", "Bash", "k3d -v cluster delete a", true],
    ["Bash(kore * destroy)", "Bash", "kore local destroy", true],
    ["Bash(kore * destroy)", "Bash", "kore local destroy --yes", false],
    ["Bash(kore * destroy *)", "Bash", "kore local destroy --yes", true],
    ["Read(./.kore/keys/**)", "Read", ".kore/keys/a/b", true],
    ["Read(./.kore/keys/**)", "Read", ".kore/other", false],
    ["Read(./.kore/state/*token*)", "Read", ".kore/state/a-token.json", true],
    ["Read(./.kore/state/*token*)", "Read", ".kore/state/a/token", false],
    ["Read(./.kore/keys/**)", "Write", ".kore/keys/a", false],
  ])("%s on %s %s is %s", (pattern, tool, subject, expected) => {
    expect(denyMatches(pattern, tool, subject)).toBe(expected);
  });
});
