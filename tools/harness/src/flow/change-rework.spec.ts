import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { reworkByChange } from "./change-rework.js";
import { time } from "./github-waits.js";
import {
  linkedAgents,
  pricedLaunches,
  writerGroup,
  type PricedLaunch,
} from "./writer-join.js";

vi.mock("./github-waits.js");
vi.mock("./writer-join.js");

let seq = 0;
const event = (
  kind: Kind,
  at: number,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent => {
  seq += 1;
  return {
    schema: 1,
    id: `e${seq}`,
    source: "claude",
    kind,
    occurredAt: new Date(at).toISOString(),
    recordedAt: new Date(at).toISOString(),
    ...fields,
  };
};

const sendBack = (number: number, at: number) =>
  event("send-back", at, { number });
const send = (agent: string, pane: string, at: number) =>
  event("session.send", at, { agent, pane });
const launch = (agent: string, pane: string): PricedLaunch => ({
  agent,
  pane,
  tier: "claude-haiku-5-5",
  idea: undefined,
  effort: undefined,
  tierReason: undefined,
  at: 0,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(time).mockImplementation((e) => Date.parse(e.occurredAt));
  vi.mocked(pricedLaunches).mockReturnValue([
    launch("h-writer", "w1:p1"),
    launch("h-other", "w1:p2"),
  ]);
  vi.mocked(linkedAgents).mockReturnValue(
    new Map([
      [100, "h-writer"],
      [101, "h-writer"],
      [200, "h-other"],
    ]),
  );
  vi.mocked(writerGroup).mockImplementation((_launches, agent) => [agent]);
});

describe("reworkByChange: the rework sends each pull request had (#1009 definition)", () => {
  it("counts a send to the writer pane after a send-back for that pull request as one rework for it", () => {
    const events = [sendBack(100, 10), send("h-writer", "w1:p1", 20)];

    expect(reworkByChange(events)).toEqual(new Map([[100, 1]]));
  });

  it("counts each send after the send-back, and a send once however many send-backs came before it", () => {
    const events = [
      sendBack(100, 10),
      sendBack(100, 15),
      send("h-writer", "w1:p1", 20),
      send("h-writer", "w1:p1", 30),
    ];

    expect(reworkByChange(events)).toEqual(new Map([[100, 2]]));
  });

  it("does not count a send before the send-back", () => {
    const events = [send("h-writer", "w1:p1", 5), sendBack(100, 10)];

    expect(reworkByChange(events)).toEqual(new Map());
  });

  it("does not count a send to a writer that did not start the sent-back pull request", () => {
    const events = [sendBack(200, 10), send("h-writer", "w1:p1", 20)];

    expect(reworkByChange(events)).toEqual(new Map());
  });

  it("does not count a send to a pane no priced writer launched on", () => {
    const events = [sendBack(100, 10), send("h-writer", "w9:p9", 20)];

    expect(reworkByChange(events)).toEqual(new Map());
  });

  it("credits a send to every pull request of its writer that was sent back before it", () => {
    const events = [
      sendBack(100, 10),
      sendBack(101, 12),
      send("h-writer", "w1:p1", 20),
    ];

    expect(reworkByChange(events)).toEqual(
      new Map([
        [100, 1],
        [101, 1],
      ]),
    );
  });

  it("ignores a send-back that names no pull request and one for a pull request with no linked writer", () => {
    const events = [
      event("send-back", 10),
      sendBack(300, 11),
      send("h-writer", "w1:p1", 20),
    ];

    expect(reworkByChange(events)).toEqual(new Map());
  });
});
