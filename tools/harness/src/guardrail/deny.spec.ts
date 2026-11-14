// The deny unit: the generated settings deny list, its drift check, and pattern
// matching. Inventories are typed literals, so the parser is not a collaborator.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it } from "vitest";
import type { Guardrail, Inventory } from "./inventory.js";
import { denyDrift, denyList, denyMatches, settingsWithDeny } from "./deny.js";

const rule = (over: Partial<Guardrail> = {}): Guardrail => ({
  rule: "deny-x",
  kind: "bash",
  mode: "enforce",
  owner: ".claude/settings.json",
  deny: ["Bash(x:*)"],
  ...over,
});
const inventory = (...guardrails: Guardrail[]): Inventory => ({ guardrails });

describe("the generated deny list", () => {
  it("holds only rules in enforce mode", () => {
    const inv = inventory(
      rule(),
      rule({ rule: "deny-y", mode: "audit", deny: ["Bash(y:*)"] }),
    );
    expect(denyList(inv)).toEqual(["Bash(x:*)"]);
  });

  it("lists the patterns of every enforced rule, in inventory order", () => {
    const inv = inventory(
      rule({ deny: ["Bash(a:*)", "Bash(b:*)"] }),
      rule({ rule: "deny-z", deny: ["Read(./z/**)"], kind: "file" }),
    );
    expect(denyList(inv)).toEqual(["Bash(a:*)", "Bash(b:*)", "Read(./z/**)"]);
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

  it("treats settings with no permissions key as an empty deny list", () => {
    expect(denyDrift(inv, JSON.stringify({ hooks: {} }))).toEqual([
      expect.stringMatching(/Bash\(x:\*\).*missing/),
    ]);
  });
});

describe("matching a deny pattern", () => {
  it.each([
    ["Bash(k3d cluster delete:*)", "Bash", "k3d cluster delete a", true],
    ["Bash(k3d cluster delete:*)", "Bash", "k3d cluster deletex", false],
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
