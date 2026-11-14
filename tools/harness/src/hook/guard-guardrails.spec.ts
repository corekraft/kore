// The guardrail inventory and settings deny list protect themselves: demotions, weakened deny patterns and rewrites warn. `writtenPath` and `warn` are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { writtenPath } from "./guard-append-only.js";
import {
  checkDenyRemovalBash,
  checkGuardrailBash,
  checkGuardrailDemotion,
  checkSettingsDenyRemoval,
} from "./guard-guardrails.js";
import { warn, type GuardContext, type Hit } from "./guard-verdict.js";
import type { DenyRule } from "../guardrail/index.js";

vi.mock("./guard-append-only.js", () => ({ writtenPath: vi.fn() }));
vi.mock("./guard-verdict.js", () => ({ warn: vi.fn() }));

const INVENTORY = ".claude/guardrails.yaml";
const SETTINGS = ".claude/settings.json";

const ctxWith = (denyRules: DenyRule[]): GuardContext => ({
  root: "/repo",
  readFile: () => Promise.reject(new Error("no file in this unit")),
  globMatches: () => Promise.resolve(false),
  modeOf: () => "enforce",
  denyRules,
});

beforeEach(() => {
  vi.mocked(warn).mockImplementation((rule: string, message: string): Hit => ({
    action: "warn",
    rule,
    message,
  }));
  vi.mocked(writtenPath).mockReturnValue(undefined);
});

describe("checkGuardrailDemotion", () => {
  it("ignores a file other than the inventory", () => {
    const before = '{"rule": "append-only", "mode": "enforce"}';
    const after = '{"rule": "append-only", "mode": "audit"}';
    expect(checkGuardrailDemotion(SETTINGS, before, after)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when an enforced rule turns to audit by hand", () => {
    const finding = checkGuardrailDemotion(
      INVENTORY,
      '{"rule": "append-only", "mode": "enforce"}',
      '{"rule": "append-only", "mode": "audit"}',
    );
    expect(finding).toMatchObject({
      action: "warn",
      rule: "guardrail-demotion",
    });
    expect(warn).toHaveBeenCalledWith(
      "guardrail-demotion",
      expect.stringContaining(
        "turns append-only from enforce to audit by hand",
      ),
    );
  });

  it("warns when a deny pattern is removed or narrowed, and not when one is only added", () => {
    const before =
      '{"rule": "no-rm", "mode": "enforce", "deny": ["Bash(rm:*)", "Bash(git:*)"]}';
    const dropped =
      '{"rule": "no-rm", "mode": "enforce", "deny": ["Bash(rm:*)"]}';
    const added =
      '{"rule": "no-rm", "mode": "enforce", "deny": ["Bash(rm:*)", "Bash(git:*)", "Bash(x:*)"]}';
    expect(checkGuardrailDemotion(INVENTORY, before, dropped)).toMatchObject({
      rule: "guardrail-demotion",
    });
    expect(warn).toHaveBeenCalledWith(
      "guardrail-demotion",
      expect.stringContaining(
        "removes, narrows or renames deny patterns (no-rm) by hand",
      ),
    );
    vi.mocked(warn).mockClear();
    expect(checkGuardrailDemotion(INVENTORY, before, added)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("names a rule when a change edits only a bare mode line from enforce to audit", () => {
    checkGuardrailDemotion(INVENTORY, '"mode": "enforce"', '"mode": "audit"');
    expect(vi.mocked(warn).mock.calls[0]?.[1]).toContain(
      "turns a rule from enforce to audit by hand",
    );
  });

  it("names both problems in one warning when a change demotes and weakens", () => {
    const before = '{"rule": "a", "mode": "enforce", "deny": ["Bash(x:*)"]}';
    const after = '{"rule": "a", "mode": "audit", "deny": []}';
    checkGuardrailDemotion(INVENTORY, before, after);
    expect(vi.mocked(warn).mock.calls[0]?.[1]).toContain(
      "turns a from enforce to audit by hand and removes, narrows or renames deny patterns (a) by hand",
    );
  });
});

describe("checkGuardrailBash", () => {
  it("warns when a command rewrites the inventory or the settings file, naming the path", () => {
    vi.mocked(writtenPath).mockReturnValue("/repo/.claude/guardrails.yaml");
    expect(
      checkGuardrailBash("sed", ["-i", "s/a/b/", INVENTORY], []),
    ).toMatchObject({
      rule: "guardrail-demotion",
    });
    expect(warn).toHaveBeenCalledWith(
      "guardrail-demotion",
      expect.stringContaining(
        ".claude/guardrails.yaml is rewritten by a command",
      ),
    );
  });

  it("matches only protected targets, and stays silent when nothing is rewritten", () => {
    vi.mocked(writtenPath).mockReturnValue(undefined);
    expect(checkGuardrailBash("tee", ["x"], [])).toBeNull();
    const matches = vi.mocked(writtenPath).mock.calls[0]?.[3];
    expect(matches?.(".claude/settings.json")).toBe(true);
    expect(matches?.(".github/rulesets/main.json")).toBe(true);
    expect(matches?.("src/index.ts")).toBe(false);
  });
});

describe("checkDenyRemovalBash", () => {
  it("warns on guardrail deny with --allow-removal, and not without it", () => {
    expect(
      checkDenyRemovalBash("guardrail", ["deny", "--write", "--allow-removal"]),
    ).toMatchObject({
      rule: "guardrail-demotion",
    });
    expect(checkDenyRemovalBash("guardrail", ["deny", "--write"])).toBeNull();
    expect(
      checkDenyRemovalBash("guardrail", ["ruleset", "--allow-removal"]),
    ).toBeNull();
  });
});

describe("checkSettingsDenyRemoval", () => {
  it("ignores a file other than the settings file", () => {
    expect(
      checkSettingsDenyRemoval(INVENTORY, "{}", "{}", ctxWith([])),
    ).toBeNull();
  });

  it("warns when a JSON deny list drops a pattern, and names the dropped pattern", () => {
    const before = '{"permissions": {"deny": ["Bash(rm:*)", "Bash(git:*)"]}}';
    const after = '{"permissions": {"deny": ["Bash(rm:*)"]}}';
    checkSettingsDenyRemoval(SETTINGS, before, after, ctxWith([]));
    expect(warn).toHaveBeenCalledWith(
      "guardrail-demotion",
      expect.stringContaining(
        "removes or narrows the deny patterns Bash(git:*) by hand",
      ),
    );
  });

  it("falls back to the inventory's patterns when a side is not JSON", () => {
    const denyRules: DenyRule[] = [
      { rule: "no-rm", mode: "enforce", patterns: ["Bash(rm:*)"] },
    ];
    const finding = checkSettingsDenyRemoval(
      SETTINGS,
      '"Bash(rm:*)" not json',
      "edited",
      ctxWith(denyRules),
    );
    expect(finding).toMatchObject({ rule: "guardrail-demotion" });
    expect(vi.mocked(warn).mock.calls[0]?.[1]).toContain("Bash(rm:*)");
  });

  it("stays silent when the deny list keeps every pattern", () => {
    const text = '{"permissions": {"deny": ["Bash(rm:*)"]}}';
    expect(
      checkSettingsDenyRemoval(SETTINGS, text, text, ctxWith([])),
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
