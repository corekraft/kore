import { describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";
import { measurement } from "./measurement.js";

const { ledgerCommands, flowCommands, queueCommands } = vi.hoisted(() => {
  const command: Command = { summary: "x", run: () => Promise.resolve(0) };
  return {
    ledgerCommands: { record: command },
    flowCommands: { report: command },
    queueCommands: { next: command },
  };
});

vi.mock("./ledger-commands.js", () => ({ ledgerCommands }));
vi.mock("./flow-commands.js", () => ({ flowCommands }));
vi.mock("./queue-commands.js", () => ({ queueCommands }));

describe("measurement command map", () => {
  it("maps the ledger domain to the ledger commands and the flow domain to the flow commands", () => {
    expect(measurement).toEqual({
      ledger: ledgerCommands,
      flow: flowCommands,
      queue: queueCommands,
    });
  });

  it("maps each domain word to the same command map object, not a copy", () => {
    expect(measurement.ledger).toBe(ledgerCommands);
    expect(measurement.flow).toBe(flowCommands);
    expect(measurement.queue).toBe(queueCommands);
  });
});
