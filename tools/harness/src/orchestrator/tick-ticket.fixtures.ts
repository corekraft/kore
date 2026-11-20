import { vi } from "vitest";
import type { IdeaPane, TickPorts } from "./tick.js";
import { Tick } from "./tick.js";
import type { PassBounds, PassGate } from "./tick-bounds.js";

export const HEAD = "abcdef1234567890";
export const TICKET = {
  kind: "ticket",
  issue: 1419,
  since: "2026-11-20",
  lane: "product",
  horizon: "next",
  labels: ["ready-for-agent"],
} as const;

export function ports(over: Partial<TickPorts> = {}): TickPorts {
  return {
    queue: vi.fn().mockResolvedValue([TICKET]),
    panes: vi.fn().mockResolvedValue([]),
    delivery: vi.fn().mockResolvedValue({ merged: false }),
    head: vi.fn().mockResolvedValue(HEAD),
    reviewPosted: vi.fn().mockResolvedValue(true),
    spawn: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sendBacks: vi
      .fn()
      .mockResolvedValue({ count: 1, model: "haiku", escalate: false }),
    workPlan: vi.fn().mockResolvedValue(undefined),
    ticketsOn: vi.fn().mockResolvedValue(true),
    issueTitle: vi.fn().mockResolvedValue("Tick works tickets"),
    ...over,
  } as unknown as TickPorts;
}

export const pane = (name: string, state: IdeaPane["state"]): IdeaPane => ({
  name,
  state,
});

export function gate(bounds: PassBounds = { saver: false }) {
  return {
    read: vi.fn<PassGate["read"]>().mockResolvedValue(bounds),
    record: vi.fn<PassGate["record"]>().mockResolvedValue(undefined),
  };
}

export const on = (p: TickPorts, g: PassGate = gate()) =>
  new Tick(p, new Map(), g);

export const WRITER_BRIEF =
  "Work issue #1419: Tick works tickets. Read the issue, follow writer.md, and deliver it as one pull request that says `Refs #1419`. Do not merge.";
export const JUDGE_BRIEF =
  "Judge PR #7 for issue #1419 (Tick works tickets): run the precheck, then approve and merge it, or send it back with the reason.";
export const KEY = "ticket-1419";
export const open = { pr: 7, merged: false };
