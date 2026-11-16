// The guardrail domain's command table: every ledger-backed command, plus the replay.

import { describe, expect, it, vi } from "vitest";
import { guardrailCliCommands } from "./guardrail-commands.js";
import { guardrailLedgerCommands } from "./guardrail-request-commands.js";
import { guardrailReplay } from "./guardrail-replay-commands.js";

vi.mock("./guardrail-request-commands.js", () => ({
  guardrailLedgerCommands: {
    status: { summary: "status" },
    request: { summary: "request" },
    activate: { summary: "activate" },
  },
}));
vi.mock("./guardrail-replay-commands.js", () => ({
  guardrailReplay: { summary: "replay" },
}));

describe("guardrail command table", () => {
  it("keeps every ledger-backed command and adds the replay", () => {
    expect(guardrailCliCommands).toEqual({
      ...guardrailLedgerCommands,
      replay: guardrailReplay,
    });
  });
});
