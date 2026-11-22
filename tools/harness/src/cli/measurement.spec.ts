import { describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";
import { measurement } from "./measurement.js";

const {
  ledgerCommands,
  flowCommands,
  queueDomain,
  retroCommands,
  orchestrateCommands,
  approveCommand,
  evaluateCommand,
} = vi.hoisted(() => {
  const command: Command = { summary: "x", run: () => Promise.resolve(0) };
  return {
    ledgerCommands: { record: command },
    flowCommands: { report: command },
    queueDomain: { next: command },
    retroCommands: { due: command },
    orchestrateCommands: { run: command },
    approveCommand: command,
    evaluateCommand: command,
  };
});

vi.mock("./ledger-commands.js", () => ({ ledgerCommands }));
vi.mock("./flow-commands.js", () => ({ flowCommands }));
vi.mock("./queue-help.js", () => ({ queueDomain }));
vi.mock("./retro-commands.js", () => ({ retroCommands }));
vi.mock("./approve-commands.js", () => ({ approveCommand }));
vi.mock("./evaluate-commands.js", () => ({ evaluateCommand }));
vi.mock("./orchestrate-commands.js", () => ({ orchestrateCommands }));

describe("measurement command map", () => {
  it("maps the ledger domain to the ledger commands and the flow domain to the flow commands", () => {
    expect(measurement).toEqual({
      ledger: ledgerCommands,
      flow: flowCommands,
      queue: queueDomain,
      retro: retroCommands,
      orchestrate: orchestrateCommands,
      approve: { "": approveCommand },
      evaluate: { "": evaluateCommand },
    });
  });

  it("maps each domain word to the same command map object, not a copy", () => {
    expect(measurement.ledger).toBe(ledgerCommands);
    expect(measurement.flow).toBe(flowCommands);
    expect(measurement.queue).toBe(queueDomain);
    expect(measurement.retro).toBe(retroCommands);
    expect(measurement.orchestrate).toBe(orchestrateCommands);
  });

  it("gives approve the empty command word, since it is the domain's only command", () => {
    expect(measurement.approve).toEqual({ "": approveCommand });
  });
});
