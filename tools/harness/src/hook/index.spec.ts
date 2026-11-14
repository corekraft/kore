// The hook registry: each hook the host runs as `harness hook <name>` is keyed here.
// The hooks are mocked; only the key under which the test-budget command is registered is real.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";

const budget: Command = { summary: "budget", options: {}, run: vi.fn() };

vi.mock("./test-budget.js", () => ({ testBudgetHook: budget }));
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
});
