import { vi } from "vitest";
import { decide } from "./judgment-flow.js";
import { judgmentBrief, readerBrief } from "./judgment-briefs.js";
import {
  flowOf,
  isFinished,
  isOpen,
  judgmentName,
  readerName,
  retryName,
  type Flow,
  type FlowPane,
} from "./judgment-panes.js";
import { checkPlan, readPlan } from "./judgment-plan.js";
import { readSummary } from "./judgment-summary.js";
import type { JudgmentPorts } from "./tick-judgment.js";

export const IDEA = "0007";
export const ISSUE = 873;
export const PR = 12;

export const pane = (name: string, state: FlowPane["state"]): FlowPane => ({
  name,
  state,
});

export const flow = (over: Partial<Flow> = {}): Flow => ({
  decisions: [],
  rounds: [],
  readRounds: 0,
  refusals: 0,
  nextOrd: 1,
  ...over,
});

export function ports(over: Partial<JudgmentPorts> = {}): JudgmentPorts {
  return {
    spawn: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    paneText: vi.fn().mockResolvedValue(""),
    delivery: vi.fn().mockResolvedValue({ merged: false, pr: PR }),
    needsInfo: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

export const admitted = () => vi.fn().mockResolvedValue(undefined);

/** The default behaviour of each mocked helper: names as the module makes them, and an empty flow. */
export function primeMocks(): void {
  vi.mocked(judgmentName).mockImplementation(
    (idea, ord) => `idea-${idea}-judgment-r${ord}`,
  );
  vi.mocked(retryName).mockImplementation(
    (idea, ord) => `idea-${idea}-retry-r${ord}`,
  );
  vi.mocked(readerName).mockImplementation(
    (idea, ord, q) => `idea-${idea}-read-r${ord}-q${q}`,
  );
  vi.mocked(isOpen).mockImplementation((p) => p.state !== "closed");
  vi.mocked(isFinished).mockImplementation(
    (p) => p.state === "done" || p.state === "blocked",
  );
  vi.mocked(flowOf).mockReturnValue(flow());
  vi.mocked(judgmentBrief).mockReturnValue("JUDGMENT BRIEF");
  vi.mocked(readerBrief).mockReturnValue("READER BRIEF");
  vi.mocked(readSummary).mockImplementation((text) => `S(${text})`);
  vi.mocked(readPlan).mockReturnValue({ ok: true, raw: {} });
  vi.mocked(checkPlan).mockReturnValue({
    ok: true,
    plan: { kind: "stop", reason: "r" },
  });
  vi.mocked(decide).mockReturnValue({ step: "needs-info", reason: "r" });
}

/** A flow whose latest judgment pane is `state` and has no reader round yet. */
export function decidingFlow(
  state: FlowPane["state"],
  over: Partial<Flow> = {},
) {
  return flow({
    decisions: [
      { ord: 1, retry: false, pane: pane("idea-0007-judgment-r1", state) },
    ],
    nextOrd: 2,
    ...over,
  });
}
