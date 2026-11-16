import type { LedgerEvent } from "../ledger/index.js";
import { STAGES, type Stage } from "./stages.js";

const isStage = (value: string | undefined): value is Stage =>
  STAGES.some((stage) => stage === value);

/** The stage each session was launched into, by session name, from the stage its launch event carries. */
export function stampedStages(events: LedgerEvent[]): Map<string, Stage> {
  const stamps = new Map<string, Stage>();
  for (const { kind, agent, stage } of events) {
    if (kind === "session.launch" && agent !== undefined && isStage(stage)) {
      stamps.set(agent, stage);
    }
  }
  return stamps;
}

/** The stage the event's session was stamped with at launch, or undefined when it was not stamped. */
export function stageStamp(
  event: LedgerEvent,
  stamps: Map<string, Stage>,
): Stage | undefined {
  return event.agent === undefined ? undefined : stamps.get(event.agent);
}
