import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import type { QueueItem } from "../queue/index.js";
import { ticketQueueOn } from "../queue/index.js";
import { localFlagOn } from "./local-flag.js";
import type { BoundName } from "./tick-bounds.js";
import {
  LIVE_PROOF_LABEL,
  LIVE_PROOFS_FLAG,
  LiveProofs,
  liveProofBrief,
  liveProofName,
  liveProofsOn,
  type LiveProofPorts,
} from "./tick-live-proof.js";
import type { Starts } from "./tick-starts.js";

vi.mock("./local-flag.js", () => ({ localFlagOn: vi.fn() }));
vi.mock("../queue/index.js", () => ({ ticketQueueOn: vi.fn() }));

const ticket = (issue: number, labels: string[]): QueueItem => ({
  kind: "ticket",
  issue,
  since: "2026-11-20",
  lane: "harness",
  horizon: "next",
  labels,
});

const PROOF = [LIVE_PROOF_LABEL, "ready-for-agent"];

function ports(over: Partial<LiveProofPorts> = {}) {
  const spawnMock = vi.fn().mockResolvedValue(undefined);
  const closeMock = vi.fn().mockResolvedValue(undefined);
  return {
    panes: vi.fn().mockResolvedValue([]),
    spawn: spawnMock,
    close: closeMock,
    spawnMock,
    closeMock,
    ...over,
  };
}

/** A stub Starts: `held` answers with the bound given, and the mocks show what LiveProofs asked of it. */
function starts(bound?: BoundName) {
  const held = vi.fn().mockResolvedValue(bound);
  const record = vi.fn().mockResolvedValue(undefined);
  const taken = vi.fn();
  return {
    starts: { held, record, taken } as unknown as Starts,
    held,
    record,
    taken,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("liveProofsOn", () => {
  it("names its flag", () => {
    expect(LIVE_PROOFS_FLAG).toBe("tick-live-proofs");
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    "reads tick-live-proofs %s and tick-ticket-queue %s as %s",
    async (live, queue, expected) => {
      vi.mocked(localFlagOn).mockResolvedValue(live);
      vi.mocked(ticketQueueOn).mockResolvedValue(queue);

      expect(await liveProofsOn({} as FileSystem, "/repo")).toBe(expected);
    },
  );
});

describe("liveProofName", () => {
  it("names the pane for the ticket", () => {
    expect(liveProofName(1419)).toBe("live-proof-1419");
  });
});

describe("liveProofBrief", () => {
  const brief = liveProofBrief(1419);

  it("sends the pane to read the issue and run the proof it names", () => {
    expect(brief).toContain("issue #1419");
    expect(brief).toContain("kore local up");
  });

  it("records through verification, never an activation, and blocks with a comment", () => {
    expect(brief).toContain("harness outcome record");
    expect(brief).toContain("--kind verification --source live-run");
    expect(brief).toContain("Never run `harness flag activate`");
    expect(brief).toContain("harness decision ask");
    expect(brief).toContain("end blocked");
  });

  it("forbids dispatching the live or nightly workflows and reaching kore-vps", () => {
    expect(brief).toContain("Never dispatch live.yml or the nightly");
    expect(brief).toContain("never reach kore-vps");
  });
});

describe("LiveProofs", () => {
  it("starts one Sonnet writer for the first queued live-proof ticket", async () => {
    const p = ports();
    const { starts: s } = starts();

    const steps = await new LiveProofs(p).pass(
      [ticket(7, ["bug"]), ticket(8, PROOF), ticket(9, PROOF)],
      s,
    );

    expect(steps).toEqual([
      {
        idea: "ticket-8",
        issue: 8,
        step: "spawn-live-proof",
        pane: "live-proof-8",
      },
    ]);
    expect(p.spawnMock).toHaveBeenCalledTimes(1);
    expect(p.spawnMock).toHaveBeenCalledWith({
      role: "writer",
      name: "live-proof-8",
      issue: 8,
      worktree: true,
      model: "claude-sonnet-5-5",
      brief: liveProofBrief(8),
    });
  });

  it("does nothing when no ticket is labelled live-proof", async () => {
    const p = ports();
    const { starts: s } = starts();

    expect(await new LiveProofs(p).pass([ticket(7, ["bug"])], s)).toEqual([]);
    expect(p.spawnMock).not.toHaveBeenCalled();
  });

  it("holds and records live-run when the host lease is held, starting nothing", async () => {
    const p = ports();
    const { starts: s, held } = starts("live-run");

    const steps = await new LiveProofs(p).pass([ticket(8, PROOF)], s);

    expect(steps).toEqual([
      { idea: "ticket-8", issue: 8, step: "held", bound: "live-run" },
    ]);
    expect(held).toHaveBeenCalledWith(8);
    expect(p.spawnMock).not.toHaveBeenCalled();
  });

  it("holds and records live-proof while another live-proof pane is running", async () => {
    const p = ports({
      panes: vi
        .fn()
        .mockResolvedValue([{ name: "live-proof-5", state: "running" }]),
    });
    const { starts: s, held, record } = starts();

    const steps = await new LiveProofs(p).pass([ticket(8, PROOF)], s);

    expect(steps).toEqual([
      { idea: "ticket-8", issue: 8, step: "held", bound: "live-proof" },
    ]);
    expect(record).toHaveBeenCalledWith(8, "live-proof");
    expect(held).not.toHaveBeenCalled();
    expect(p.spawnMock).not.toHaveBeenCalled();
  });
});

describe("LiveProofs one pane at a time", () => {
  it("closes a finished live-proof pane and starts nothing that pass", async () => {
    const p = ports({
      panes: vi
        .fn()
        .mockResolvedValue([{ name: "live-proof-5", state: "done" }]),
    });
    const { starts: s } = starts();

    const steps = await new LiveProofs(p).pass([ticket(8, PROOF)], s);

    expect(steps).toEqual([
      { idea: "ticket-5", issue: 5, step: "close", pane: "live-proof-5" },
    ]);
    expect(p.closeMock).toHaveBeenCalledWith("live-proof-5");
    expect(p.spawnMock).not.toHaveBeenCalled();
  });

  it("starts nothing twice: a ticket whose pane already ran is reported blocked", async () => {
    const p = ports({
      panes: vi
        .fn()
        .mockResolvedValue([{ name: "live-proof-8", state: "closed" }]),
    });
    const { starts: s } = starts();

    const steps = await new LiveProofs(p).pass([ticket(8, PROOF)], s);

    expect(steps).toEqual([{ idea: "ticket-8", issue: 8, step: "blocked" }]);
    expect(p.spawnMock).not.toHaveBeenCalled();
  });

  it("takes the next ticket when the first one's pane already ran", async () => {
    const p = ports({
      panes: vi
        .fn()
        .mockResolvedValue([{ name: "live-proof-8", state: "closed" }]),
    });
    const { starts: s } = starts();

    const steps = await new LiveProofs(p).pass(
      [ticket(8, PROOF), ticket(9, PROOF)],
      s,
    );

    expect(steps.map((x) => x.pane)).toEqual(["live-proof-9"]);
  });

  it("tells Starts a start was taken after it spawns, and not when it holds", async () => {
    const started = starts();
    await new LiveProofs(ports()).pass([ticket(8, PROOF)], started.starts);
    const held = starts("load");
    await new LiveProofs(ports()).pass([ticket(8, PROOF)], held.starts);

    expect(started.taken).toHaveBeenCalledTimes(1);
    expect(held.taken).not.toHaveBeenCalled();
  });
});
