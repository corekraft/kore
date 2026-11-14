// The hook registry: each hook the host runs as `harness hook <name>` is keyed here.
// The hooks are mocked; only the keys under which the unit-run hooks are registered are real.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";

const budget: Command = { summary: "budget", options: {}, run: vi.fn() };
const specs: Command = { summary: "specs", options: {}, run: vi.fn() };

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
});
