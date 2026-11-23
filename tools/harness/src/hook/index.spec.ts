// The hook registry: each hook the host runs as `harness hook <name>` is keyed here.
// The hooks are mocked; only the keys under which the unit-run hooks are registered are real.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import type { Command, CommandHelp } from "../runtime/index.js";

const { budget, specs } = vi.hoisted(() => {
  const HELP: CommandHelp = {
    purpose: "A stub command.",
    when: "In a test.",
    whenNot: "Outside a test.",
    flags: {},
    examples: [{ command: "harness stub", shows: "nothing" }],
    exits: [{ code: 0, meaning: "always" }],
    effects: { kind: "read-only", detail: "nothing" },
    seeAlso: [],
  };
  const budgetCommand: Command = {
    help: HELP,
    summary: "budget",
    options: {},
    run: vi.fn(),
  };
  const specsCommand: Command = {
    help: HELP,
    summary: "specs",
    options: {},
    run: vi.fn(),
  };
  return { budget: budgetCommand, specs: specsCommand };
});

vi.mock("./test-hooks.js", () => ({
  testHooks: { "test-budget": budget, "unit-specs": specs },
}));
vi.mock("./io.js");
vi.mock("./feedback.js");
vi.mock("./guard.js");
vi.mock("./session-hooks.js");
vi.mock("./retro-hook.js");
vi.mock("./repository-checks.js");

const { hook } = await import("./index.js");

describe("the hook registry", () => {
  it("runs harness hook test-budget as the test-budget command", () => {
    expect(hook["test-budget"]).toBe(budget);
  });

  it("runs harness hook unit-specs as the one-spec check", () => {
    expect(hook["unit-specs"]).toBe(specs);
  });

  it("registers exactly the hooks the host runs, under the names it runs them by", () => {
    expect(Object.keys(hook).sort()).toEqual([
      "context",
      "delta",
      "feedback",
      "guard",
      "kb-check",
      "record",
      "retro-scan",
      "skill-links",
      "test-budget",
      "unit-specs",
      "workflow-permissions",
    ]);
  });
});
