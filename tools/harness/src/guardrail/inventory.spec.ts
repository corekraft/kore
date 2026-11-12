import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GuardrailError,
  auditRuleNames,
  modeOf,
  parseInventory,
} from "./inventory.js";

const repo = new URL("../../../../", import.meta.url).pathname;
const entry = (over: Record<string, unknown> = {}) => ({
  rule: "no-verify",
  kind: "bash",
  mode: "enforce",
  owner: "tools/harness/src/hook/guard-commands.ts",
  ...over,
});
const text = (...entries: unknown[]) => JSON.stringify({ guardrails: entries });

describe("guardrail inventory parsing", () => {
  it("lists each guardrail with its kind, mode and owner", () => {
    const inventory = parseInventory(text(entry(), entry({ rule: "x" })));
    expect(inventory.guardrails.map((g) => g.rule)).toEqual(["no-verify", "x"]);
    expect(inventory.guardrails[0]).toEqual(entry());
  });

  it("accepts a ruleset kind and a note saying why a rule has its mode", () => {
    const inventory = parseInventory(
      text(entry({ kind: "ruleset", note: "Starts in enforce: live today." })),
    );
    expect(inventory.guardrails[0]).toMatchObject({
      kind: "ruleset",
      note: "Starts in enforce: live today.",
    });
  });

  it("rejects a blank note", () => {
    expect(() => parseInventory(text(entry({ note: " " })))).toThrow(/note/);
  });

  it("rejects a deny list on a ruleset rule", () => {
    expect(() =>
      parseInventory(
        text(entry({ kind: "ruleset", deny: ["Bash(helm uninstall:*)"] })),
      ),
    ).toThrow(/does not fit its kind/);
  });

  it.each([
    ["not JSON", "guardrails: [", /JSON-compatible/],
    ["not an object", "[]", /guardrails/],
    ["no guardrails list", "{}", /guardrails/],
    ["a bad mode", text(entry({ mode: "warn" })), /mode.*audit.*enforce/],
    ["a bad kind", text(entry({ kind: "x" })), /kind/],
    ["a missing owner", text(entry({ owner: "" })), /owner/],
    ["a bad rule name", text(entry({ rule: "Not Valid" })), /rule/],
    ["an unknown field", text(entry({ extra: 1 })), /extra/],
    [
      "two entries for one rule",
      text(entry(), entry({ owner: "elsewhere" })),
      /no-verify.*exactly one entry/,
    ],
  ])(
    "rejects %s with a message that says how to fix it",
    (_, body, message) => {
      expect(() => parseInventory(body)).toThrow(GuardrailError);
      expect(() => parseInventory(body)).toThrow(message);
    },
  );
});

describe("guardrail modes", () => {
  const inventory = parseInventory(
    text(entry({ mode: "audit" }), entry({ rule: "y" })),
  );

  it("reads a rule's mode from the inventory", () => {
    expect(modeOf(inventory, "no-verify")).toBe("audit");
    expect(modeOf(inventory, "y")).toBe("enforce");
  });

  it("enforces a rule the inventory does not list", () => {
    expect(modeOf(inventory, "unlisted")).toBe("enforce");
  });

  it("names the audit rules, sorted", () => {
    expect(auditRuleNames(inventory)).toEqual(["no-verify"]);
  });
});

describe("the committed inventory", () => {
  const inventory = parseInventory(
    readFileSync(join(repo, ".claude/guardrails.yaml"), "utf8"),
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
