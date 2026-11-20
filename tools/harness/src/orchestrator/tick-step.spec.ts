import { describe, expect, it } from "vitest";
import type { IdeaStep, LiveProofPass, StepNotifier } from "./tick-step.js";

// tick-step.ts holds types only; this spec pins the shapes the live-proof pass and the tick share,
// so a change to them fails to compile here before it reaches a caller.
describe("tick step types", () => {
  it("lets a live-proof pass answer with a held step that names its bound", async () => {
    const held: IdeaStep = {
      idea: "ticket-8",
      issue: 8,
      step: "held",
      bound: "live-proof",
    };
    const pass: LiveProofPass = { pass: async () => [held] };

    expect(await pass.pass([], {} as never)).toEqual([held]);
  });

  it("lets a notifier be told a spawn-live-proof step", async () => {
    const told: string[] = [];
    const notifier: StepNotifier = {
      notify: async (step) => {
        told.push(step.step);
      },
    };

    await notifier.notify({
      idea: "ticket-8",
      step: "spawn-live-proof",
      pane: "live-proof-8",
    });

    expect(told).toEqual(["spawn-live-proof"]);
  });
});
