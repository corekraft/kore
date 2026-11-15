// The guardrail command table: activate sits beside deny, request and status, so it is reachable as
// `harness guardrail activate`. Every command module is a mock.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate
import { describe, expect, it, vi } from "vitest";
import { activate } from "./guardrail-activate-commands.js";
import { guardrailLedgerCommands } from "./guardrail-request-commands.js";

vi.mock("../guardrail/index.js", () => ({
  GuardrailError: class GuardrailError extends Error {},
  GuardrailRequest: vi.fn(),
  guardrailCommands: { deny: { summary: "deny" } },
  pendingRequests: vi.fn(),
  readInventory: vi.fn(),
  statusWith: () => ({ summary: "status" }),
}));
vi.mock("../idea/index.js", () => ({
  IdeaRepository: vi.fn(),
  IdeaError: class IdeaError extends Error {},
}));
vi.mock("../judge/index.js", () => ({
  JudgeError: class JudgeError extends Error {},
}));
vi.mock("./guardrail-activate-commands.js", () => ({
  activate: { summary: "activate" },
}));
vi.mock("./judge-shared.js");
vi.mock("./ledger-commands.js");

describe("the guardrail command table", () => {
  it("routes activate to its own command, beside deny, request and status", () => {
    expect(Object.keys(guardrailLedgerCommands).sort()).toEqual([
      "activate",
      "deny",
      "request",
      "status",
    ]);
    expect(guardrailLedgerCommands["activate"]).toBe(activate);
  });
});
